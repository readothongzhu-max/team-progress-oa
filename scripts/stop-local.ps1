$ErrorActionPreference = 'Stop'
$projectDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pidFile = Join-Path $projectDir 'data/local-server.pid'
if (!(Test-Path -LiteralPath $pidFile)) { Write-Output '没有通过启动脚本运行的服务。'; exit 0 }
$savedPid = [int](Get-Content -LiteralPath $pidFile -Raw)
$running = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
if ($running -and $running.CommandLine -like "*$projectDir*server.mjs*") {
    Stop-Process -Id $savedPid
    Write-Output '应用已停止。'
} elseif ($running) { throw '进程与本项目不匹配，未停止任何程序。' }
Remove-Item -LiteralPath $pidFile
