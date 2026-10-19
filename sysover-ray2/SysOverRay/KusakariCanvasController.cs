using System.Diagnostics;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace SysOverRay;

public sealed class KusakariCanvasController
{
    private static readonly string[] RequiredAssetIds = ["tree_oak", "shrub_boxwood", "brick_paver", "bench_wood"];
    private readonly OverlaySettings _settings;
    private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromSeconds(2) };
    private Process? _launcher;
    private readonly ProjectProcesses _processes;
    private bool _projectRunning;
    private bool LauncherActive => _launcher is { HasExited: false };
    private int? _frontendPort;
    private int? _backendPort;
    private HashSet<int> _frontendPortsBeforeStart = [];
    private int? _backendPortBeforeStart;
    private string? _stopSignalPath;
    private ServiceStatus _lastStatus = new(false, false, null, null);

    public KusakariCanvasController(OverlaySettings settings)
    {
        _settings = settings;
        _processes = new ProjectProcesses(settings.ResolvedProjectRoot);
    }

    public bool CanStart => true;
    public bool CanStop => LauncherActive || _projectRunning;
    public string? FrontendUrl => _lastStatus.FrontendUrl;

    public async Task<ServiceStatus> GetStatusAsync()
    {
        var launcherActive = LauncherActive;
        _projectRunning = await _processes.AnyAsync();
        var frontendPorts = _frontendPort is int webPort
            ? [webPort]
            : Enumerable.Range(_settings.FrontendPortRangeStart, _settings.FrontendPortRangeEnd - _settings.FrontendPortRangeStart + 1);
        var backendPorts = _backendPort is int apiPort ? [apiPort] : _settings.BackendPorts;
        var frontendTask = CheckFrontendAsync(frontendPorts, launcherActive ? _frontendPortsBeforeStart : null, launcherActive);
        var backendTask = CheckBackendAsync(backendPorts, launcherActive ? _backendPortBeforeStart : null);
        await Task.WhenAll(frontendTask, backendTask);
        var frontend = await frontendTask;
        var backend = await backendTask;
        if (_frontendPort is null) _frontendPort = frontend.Port;
        if (_backendPort is null) _backendPort = backend.Port;
        _lastStatus = new ServiceStatus(backend.Healthy, frontend.Healthy,
            frontend.Port is int fp ? $"http://127.0.0.1:{fp}" : null,
            backend.Port is int bp ? $"http://127.0.0.1:{bp}" : null);
        return _lastStatus;
    }

    public async Task StartAsync()
    {
        ValidateConfiguration();
        await StopAsync();
        try { await LaunchAsync(); }
        catch
        {
            try { await StopAsync(); }
            catch (Exception cleanupError) { AppLog.Write($"Startup cleanup failed: {cleanupError.Message}"); }
            throw;
        }
    }

    private async Task LaunchAsync()
    {
        var candidateWebPorts = Enumerable.Range(_settings.FrontendPortRangeStart,
            _settings.FrontendPortRangeEnd - _settings.FrontendPortRangeStart + 1);
        var occupiedWebPorts = new HashSet<int>();
        foreach (var port in candidateWebPorts)
        {
            if ((await CheckFrontendAsync([port], oldPorts: null, requireNew: false)).Healthy)
                occupiedWebPorts.Add(port);
        }
        var existingBackend = await CheckBackendAsync(_settings.BackendPorts, oldPort: null);
        // A stopped service may leave its last detected port in the controller.
        // Only a service that is healthy immediately before launch may be treated
        // as an existing process that the new managed session must not claim.
        _frontendPortsBeforeStart = occupiedWebPorts;
        _backendPortBeforeStart = existingBackend.Healthy ? existingBackend.Port : null;
        _frontendPort = null;
        _backendPort = null;

        var startInfo = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            WorkingDirectory = _settings.ResolvedProjectRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        startInfo.ArgumentList.Add("-NoLogo");
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-ExecutionPolicy");
        startInfo.ArgumentList.Add("Bypass");
        startInfo.ArgumentList.Add("-File");
        startInfo.ArgumentList.Add(_settings.StartScriptPath);
        startInfo.ArgumentList.Add("-NoBrowser");
        var logDirectory = Path.GetDirectoryName(AppLog.FilePath)!;
        Directory.CreateDirectory(logDirectory);
        _stopSignalPath = Path.Combine(logDirectory, $"kusakari-canvas-stop-{Guid.NewGuid():N}.signal");
        startInfo.Environment["KUSAKARI_CANVAS_STOP_REQUEST_PATH"] = _stopSignalPath;

        _launcher = Process.Start(startInfo) ?? throw new InvalidOperationException("Kusakari Canvasの起動処理を開始できませんでした。");
        _launcher.OutputDataReceived += (_, e) => RecordLauncherOutput(e.Data, isError: false);
        _launcher.ErrorDataReceived += (_, e) => RecordLauncherOutput(e.Data, isError: true);
        _launcher.BeginOutputReadLine();
        _launcher.BeginErrorReadLine();
        AppLog.Write($"Started Kusakari Canvas launcher PID {_launcher.Id}.");

        await WaitForStatusAsync(status => status.BothHealthy, _settings.StartupTimeoutSeconds,
            "Kusakari Canvasの起動確認がタイムアウトしました。ログを確認してください。");
        AppLog.Write($"Kusakari Canvas is available at {_lastStatus.FrontendUrl} (API {_lastStatus.BackendUrl}).");
    }

    public async Task StopAsync()
    {
        try
        {
            if (LauncherActive && _stopSignalPath is not null)
            {
                try
                {
                    await File.WriteAllTextAsync(_stopSignalPath, "stop");
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(_settings.ShutdownTimeoutSeconds));
                    await _launcher!.WaitForExitAsync(timeout.Token);
                }
                catch (OperationCanceledException)
                {
                    AppLog.Write("Graceful stop timed out; stopping verified project processes.");
                }
                catch (IOException ex)
                {
                    AppLog.Write($"Stop signal could not be written; stopping verified project processes: {ex.Message}");
                }
                catch (Exception ex)
                {
                    AppLog.Write($"Stop signal failed; stopping verified project processes: {ex.Message}");
                }
            }
            await _processes.StopAsync();
        }
        catch
        {
            StopLauncherTree();
            throw;
        }
        finally
        {
            if (_stopSignalPath is not null && File.Exists(_stopSignalPath))
            {
                try { File.Delete(_stopSignalPath); }
                catch (IOException ex) { AppLog.Write($"Stop signal cleanup failed: {ex.Message}"); }
            }
            _launcher?.Dispose();
            _launcher = null;
            _stopSignalPath = null;
            _frontendPort = null;
            _backendPort = null;
            _frontendPortsBeforeStart.Clear();
            _projectRunning = false;
        }
        await GetStatusAsync();
        AppLog.Write("Configured Kusakari Canvas project processes stopped.");
    }

    private void StopLauncherTree()
    {
        if (_launcher is null) return;
        try
        {
            if (!_launcher.HasExited)
            {
                _launcher.Kill(entireProcessTree: true);
                if (!_launcher.WaitForExit(5000))
                    AppLog.Write("The Kusakari Canvas launcher did not exit after forced cleanup.");
            }
        }
        catch (Exception ex)
        {
            AppLog.Write($"Forced launcher cleanup failed: {ex.Message}");
        }
    }

    public async Task RestartAsync()
    {
        await StartAsync();
    }

    private void RecordLauncherOutput(string? line, bool isError)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        AppLog.Write($"Kusakari Canvas {(isError ? "stderr" : "stdout")}: {line}");
        var urlMatch = Regex.Match(line, @"(?:http://)?127\.0\.0\.1:(\d+)");
        if (!urlMatch.Success || !int.TryParse(urlMatch.Groups[1].Value, out var port)) return;
        if (line.Contains("Kusakari Canvas Web:", StringComparison.OrdinalIgnoreCase) || line.Contains("Web起動中", StringComparison.OrdinalIgnoreCase))
            _frontendPort = port;
        if (line.Contains("Kusakari Canvas API:", StringComparison.OrdinalIgnoreCase) || line.Contains("API起動中", StringComparison.OrdinalIgnoreCase) || line.Contains("既存のKusakari Canvas API", StringComparison.OrdinalIgnoreCase))
        {
            _backendPort = port;
        }
    }

    private async Task<(bool Healthy, int? Port)> CheckFrontendAsync(IEnumerable<int> ports, IReadOnlySet<int>? oldPorts, bool requireNew)
    {
        int? oldHealthyPort = null;
        foreach (var port in ListeningCandidates(ports))
        {
            try
            {
                using var response = await _httpClient.GetAsync($"http://127.0.0.1:{port}/");
                if (!response.IsSuccessStatusCode) continue;
                var content = await response.Content.ReadAsStringAsync();
                if (content.Contains("Kusakari Canvas", StringComparison.OrdinalIgnoreCase))
                {
                    if (oldPorts?.Contains(port) != true) return (true, port);
                    oldHealthyPort = port;
                }
            }
            catch (HttpRequestException) { }
            catch (TaskCanceledException) { }
        }
        return requireNew ? (false, _frontendPort) : (oldHealthyPort is not null, oldHealthyPort ?? _frontendPort);
    }

    private async Task<(bool Healthy, int? Port)> CheckBackendAsync(IEnumerable<int> ports, int? oldPort)
    {
        int? oldHealthyPort = null;
        foreach (var port in ListeningCandidates(ports))
        {
            try
            {
                using var response = await _httpClient.GetAsync($"http://127.0.0.1:{port}/api/assets");
                if (!response.IsSuccessStatusCode) continue;
                using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                var ids = document.RootElement.EnumerateArray()
                .Select(asset => asset.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String ? id.GetString() : null)
                    .ToHashSet(StringComparer.Ordinal);
                if (RequiredAssetIds.All(ids.Contains))
                {
                    if (port != oldPort) return (true, port);
                    oldHealthyPort = port;
                }
            }
            catch (HttpRequestException) { }
            catch (TaskCanceledException) { }
            catch (JsonException) { }
            catch (InvalidOperationException) { }
        }
        return (oldHealthyPort is not null, oldHealthyPort ?? _backendPort);
    }

    private static IEnumerable<int> ListeningCandidates(IEnumerable<int> ports)
    {
        try
        {
            // Closed Windows loopback ports can each consume the HTTP timeout.
            // Discovery is read-only; stopping still requires command + creation-time ownership.
            var listening = IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners()
                .Select(endpoint => endpoint.Port).ToHashSet();
            return ports.Where(listening.Contains).ToArray();
        }
        catch (NetworkInformationException)
        {
            // Keep the previous safe probe behavior if listener enumeration is unavailable.
            return ports.ToArray();
        }
    }

    private async Task WaitForStatusAsync(Func<ServiceStatus, bool> predicate, int timeoutSeconds, string message)
    {
        var deadline = DateTime.UtcNow.AddSeconds(timeoutSeconds);
        while (DateTime.UtcNow < deadline)
        {
            if (_launcher is { HasExited: true })
                throw new InvalidOperationException($"Kusakari Canvasの起動プロセスが終了しました (exit {_launcher.ExitCode})。オーバーレイのログを確認してください。");
            if (predicate(await GetStatusAsync())) return;
            await Task.Delay(500);
        }
        throw new TimeoutException(message);
    }

    private void ValidateConfiguration()
    {
        if (!Directory.Exists(_settings.ResolvedProjectRoot))
            throw new DirectoryNotFoundException($"Kusakari Canvasのフォルダーが見つかりません: {_settings.ResolvedProjectRoot}");
        if (!File.Exists(_settings.StartScriptPath))
            throw new FileNotFoundException("Kusakari Canvasの起動スクリプトが見つかりません。", _settings.StartScriptPath);
        if (_settings.FrontendPortRangeStart < 1 || _settings.FrontendPortRangeEnd > 65535 ||
            _settings.FrontendPortRangeStart > _settings.FrontendPortRangeEnd || _settings.BackendPorts is null ||
            _settings.BackendPorts.Length == 0 || _settings.BackendPorts.Any(port => port < 1 || port > 65535) ||
            _settings.StartupTimeoutSeconds < 5 || _settings.ShutdownTimeoutSeconds < 1)
            throw new InvalidOperationException("Kusakari Canvasのポートまたはタイムアウト設定が不正です。");
    }

}

public readonly record struct ServiceStatus(bool BackendHealthy, bool FrontendHealthy, string? FrontendUrl, string? BackendUrl)
{
    public bool BothHealthy => BackendHealthy && FrontendHealthy;
    public bool AnyHealthy => BackendHealthy || FrontendHealthy;
}
