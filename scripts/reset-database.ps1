[CmdletBinding()]
param(
  # 対象を表示するだけで、何も変更しない。
  [switch]$DryRun,
  # 消す前のバックアップを取らない。
  [switch]$NoBackup
)

$ErrorActionPreference = 'Stop'

# 実行したらそのまま最後まで進める。確認の入力も管理者の権限も使わない（2026-11-16 の決定、docs/database-reset.md）。
# DB の操作は Canvas 用の DB ユーザーの権限で足りる。
$exitCode = 1
try {
  . (Join-Path $PSScriptRoot 'paths.ps1')
  $repoRoot = Get-KusakariCanvasRepoRoot -StartPath $PSScriptRoot
  $backendRoot = Join-Path $repoRoot 'backend'

  # 新しいコードを取得した後でも DB-reset.bat だけで済むように、このフォルダーの start.bat（start.ps1）を止め、
  # Python の依存をロックファイルに合わせる。作り直しの後の確認は、この .venv でマイグレーションを実行するため。
  if (-not $DryRun) {
    $startScript = Join-Path $repoRoot 'start.ps1'
    # start.ps1 が起動した API と Web は、その子プロセス。ほかの作業フォルダーの start.ps1 はパスが違うので止めない。
    # ほかの方法で起動したものは、作り直しの前に DB への接続を切る。
    $running = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" |
      Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.IndexOf($startScript, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
    foreach ($process in $running) {
      Write-Host "このフォルダーの Kusakari Canvas（PID $($process.ProcessId)）を止めます。"
      & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.ProcessId /T /F | Out-Null
    }
    Write-Host 'Python の依存をロックファイルに合わせます。'
    Push-Location $repoRoot
    try { & node (Join-Path $repoRoot 'scripts\api.mjs') compile }
    finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'Python の依存の準備に失敗しました。上の出力を確認してください。DB は変更していません。' }
  }

  $python = Join-Path $backendRoot '.venv\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw 'Python の実行環境がありません。先に setup.bat を実行してください。DB は変更していません。'
  }

  # バックアップに使う mysqldump の場所を、セットアップと同じ方法で決める。
  . (Join-Path $PSScriptRoot 'mysql-tools.ps1')
  $env:KUSAKARI_CANVAS_MYSQL_BIN = Get-KusakariCanvasMySqlBin

  $arguments = @('-m', 'kusakari_canvas_api.reset_database')
  if ($DryRun) { $arguments += '--dry-run' }
  if ($NoBackup) { $arguments += '--no-backup' }

  Push-Location $backendRoot
  try { & $python @arguments }
  finally { Pop-Location }
  $exitCode = $LASTEXITCODE
} catch {
  Write-Host $_.Exception.Message
  $exitCode = 1
}
exit $exitCode
