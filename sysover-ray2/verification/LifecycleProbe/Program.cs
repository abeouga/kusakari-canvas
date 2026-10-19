using System.Text.Json;
using SysOverRay;

var destinationRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
var gardenRoot = args.Length > 0 ? Path.GetFullPath(args[0]) : Path.GetFullPath(Path.Combine(destinationRoot, ".."));
var settings = new OverlaySettings
{
    ProjectRoot = Path.GetRelativePath(AppContext.BaseDirectory, gardenRoot),
    StartupTimeoutSeconds = 180,
    ShutdownTimeoutSeconds = 20
};
var controller = new KusakariCanvasController(settings);
var observations = new List<object>();

void Record(string step, ServiceStatus status)
{
    observations.Add(new
    {
        step,
        frontendHealthy = status.FrontendHealthy,
        frontendUrl = status.FrontendUrl,
        backendHealthy = status.BackendHealthy,
        backendUrl = status.BackendUrl,
        observedAt = DateTimeOffset.Now
    });
    Console.WriteLine($"{step}: web={status.FrontendUrl ?? "stopped"} ({status.FrontendHealthy}), api={status.BackendUrl ?? "stopped"} ({status.BackendHealthy})");
}

async Task<bool> IsWebHealthy(int port)
{
    using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
    try
    {
        using var response = await client.GetAsync($"http://127.0.0.1:{port}/");
        return response.IsSuccessStatusCode &&
            (await response.Content.ReadAsStringAsync()).Contains("Kusakari Canvas", StringComparison.OrdinalIgnoreCase);
    }
    catch (HttpRequestException) { return false; }
    catch (TaskCanceledException) { return false; }
}

try
{
    Record("baseline", await controller.GetStatusAsync());
    if (controller.CanStop)
    {
        await controller.StopAsync();
        var existingStopped = await controller.GetStatusAsync();
        Record("existing-stop", existingStopped);
        if (existingStopped.AnyHealthy) throw new InvalidOperationException("Existing project services remained after stop.");
    }
    await controller.StartAsync();
    var started = await controller.GetStatusAsync();
    Record("start", started);
    if (!started.BothHealthy) throw new InvalidOperationException("Start did not produce healthy Kusakari Canvas Web and API.");
    var managedPort = new Uri(started.FrontendUrl!).Port;

    await controller.StopAsync();
    var stopped = await controller.GetStatusAsync();
    Record("stop", stopped);
    if (stopped.AnyHealthy || await IsWebHealthy(managedPort)) throw new InvalidOperationException("Managed Kusakari Canvas Web remained healthy after stop.");

    await controller.StartAsync();
    var restartedFromStopped = await controller.GetStatusAsync();
    Record("start-after-stop", restartedFromStopped);
    if (!restartedFromStopped.BothHealthy) throw new InvalidOperationException("Start after stop failed.");

    await controller.RestartAsync();
    var restarted = await controller.GetStatusAsync();
    Record("restart", restarted);
    if (!restarted.BothHealthy) throw new InvalidOperationException("Restart did not recover both services.");

    await controller.StopAsync();
    var final = await controller.GetStatusAsync();
    Record("final-stop", final);
    if (final.AnyHealthy || await IsWebHealthy(new Uri(restarted.FrontendUrl!).Port))
        throw new InvalidOperationException("Managed Kusakari Canvas Web remained after final stop.");
}
finally
{
    if (controller.CanStop) await controller.StopAsync();
}

var report = new
{
    result = "passed",
    test = "KusakariCanvasController existing-project stop and real start/stop/restart",
    overlaySource = "sysover-ray2/SysOverRay",
    observations
};
var reportPath = Path.Combine(destinationRoot, "verification", "lifecycle-report.json");
await File.WriteAllTextAsync(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"REPORT: {reportPath}");
