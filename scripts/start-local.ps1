$ErrorActionPreference = 'Stop'
$projectDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dataDir = Join-Path $projectDir 'data'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$pidFile = Join-Path $dataDir 'local-server.pid'
if (Test-Path -LiteralPath $pidFile) {
    $savedPid = [int](Get-Content -LiteralPath $pidFile -Raw)
    $running = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
    if ($running -and $running.CommandLine -like "*$projectDir*server.mjs*") {
        Write-Output '应用已经运行：http://127.0.0.1:3210'
        exit 0
    }
}
$nodePath = (Get-Command node -ErrorAction Stop).Source
$serverPath = Join-Path $projectDir 'server.mjs'
$envPath = Join-Path $projectDir '.env'
$nodeArgs = @("--env-file-if-exists=`"$envPath`"", "`"$serverPath`"")
$process = Start-Process -FilePath $nodePath -ArgumentList $nodeArgs -WorkingDirectory $projectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dataDir 'server.log') -RedirectStandardError (Join-Path $dataDir 'server-error.log')
$process.Id | Set-Content -LiteralPath $pidFile
Write-Output '应用正在启动：http://127.0.0.1:3210'
Write-Output "首次账号见：$dataDir\initial-access.txt"
