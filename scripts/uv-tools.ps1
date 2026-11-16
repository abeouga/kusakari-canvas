# setup.ps1 と reset-database.ps1 が、同じ方法で uv を見つけるための関数。
# DB-reset.bat は setup.ps1 を通らないため、ここで探し方をそろえる（issue #80）。

function Test-KusakariCanvasUv {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  $versionText = (& $Path --version 2>$null | Select-Object -First 1)
  if ($versionText -notmatch 'uv\s+(\d+\.\d+\.\d+)') { return $false }
  return ([version]$Matches[1] -ge [version]'0.8.0')
}

# 見つからないときは $null を返す。取得（ダウンロード）は setup.ps1 だけが行う。
function Find-KusakariCanvasUv {
  param([Parameter(Mandatory)][string]$CanvasHome)

  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($env:KUSAKARI_CANVAS_UV)) { $candidates += $env:KUSAKARI_CANVAS_UV }
  $command = Get-Command uv.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $command) { $candidates += $command.Source }
  $candidates += Join-Path $CanvasHome 'tools\uv\uv.exe'

  # エクスプローラーから起動したウィンドウは、uv を入れた後の PATH を持っていないことがある。
  # Windows に保存された PATH と、uv の公式インストーラーと winget の既定の場所も見る。
  $savedPath = @(
    [Environment]::GetEnvironmentVariable('Path', 'User'),
    [Environment]::GetEnvironmentVariable('Path', 'Machine')
  ) -join ';'
  foreach ($directory in ($savedPath -split ';')) {
    if ([string]::IsNullOrWhiteSpace($directory)) { continue }
    $candidates += Join-Path ([Environment]::ExpandEnvironmentVariables($directory.Trim())) 'uv.exe'
  }
  if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    $candidates += Join-Path $env:USERPROFILE '.local\bin\uv.exe'
    $candidates += Join-Path $env:USERPROFILE '.cargo\bin\uv.exe'
  }
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $candidates += Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\uv.exe'
  }

  foreach ($candidate in $candidates) {
    try {
      if (Test-KusakariCanvasUv -Path $candidate) { return [IO.Path]::GetFullPath($candidate) }
    } catch {
      # 壊れた PATH の項目や実行できないファイルは飛ばして、次の候補を見る。
    }
  }
  return $null
}
