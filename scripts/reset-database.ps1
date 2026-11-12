[CmdletBinding()]
param(
  # 対象を表示するだけで、何も変更しない。
  [switch]$DryRun,
  # 消す前のバックアップを取らない。
  [switch]$NoBackup,
  # 確認の文字を引数で渡す（検証用）。指定しないときは画面で入力を求める。
  [string]$ConfirmText
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'paths.ps1')
$repoRoot = Get-KusakariCanvasRepoRoot -StartPath $PSScriptRoot
$backendRoot = Join-Path $repoRoot 'backend'
$python = Join-Path $backendRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
  Write-Host 'Python の実行環境がありません。先に setup.bat を実行してください。DB は変更していません。'
  exit 1
}

# バックアップに使う mysqldump の場所を、セットアップと同じ方法で決める。
. (Join-Path $PSScriptRoot 'mysql-tools.ps1')
$env:KUSAKARI_CANVAS_MYSQL_BIN = Get-KusakariCanvasMySqlBin

$arguments = @('-m', 'kusakari_canvas_api.reset_database')
if ($DryRun) { $arguments += '--dry-run' }
if ($NoBackup) { $arguments += '--no-backup' }
if ($PSBoundParameters.ContainsKey('ConfirmText')) { $arguments += @('--confirm-text', $ConfirmText) }

Push-Location $backendRoot
try { & $python @arguments }
finally { Pop-Location }
exit $LASTEXITCODE
