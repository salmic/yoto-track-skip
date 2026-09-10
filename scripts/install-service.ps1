# Installs Yoto Track Skip as a Windows service using NSSM.
# Run from an elevated PowerShell prompt:
#   .\scripts\install-service.ps1

param(
  [string]$ServiceName = "YotoTrackSkip",
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

function Find-Nssm {
  $candidates = @(
    (Join-Path $ProjectRoot "tools\nssm.exe"),
    "C:\Program Files\nssm\nssm.exe",
    "C:\Program Files (x86)\nssm\nssm.exe"
  )

  foreach ($path in $candidates) {
    if (Test-Path $path) { return $path }
  }

  throw "NSSM not found. Download from https://nssm.cc/ and place nssm.exe in tools\nssm.exe or install globally."
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$entryPoint = Join-Path $ProjectRoot "dist\index.js"
$envFile = Join-Path $ProjectRoot ".env"
$logsDir = Join-Path $ProjectRoot "data\logs"

if (-not (Test-Path $entryPoint)) {
  throw "Build output not found at $entryPoint. Run 'npm run build' first."
}

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$nssm = Find-Nssm

Write-Host "Installing service '$ServiceName'..."
& $nssm install $ServiceName $nodePath $entryPoint
& $nssm set $ServiceName AppDirectory $ProjectRoot
& $nssm set $ServiceName DisplayName "Yoto Track Skip"
& $nssm set $ServiceName Description "Auto-skips configured tracks on Yoto cards"
& $nssm set $ServiceName Start SERVICE_AUTO_START
& $nssm set $ServiceName AppStdout (Join-Path $logsDir "service.out.log")
& $nssm set $ServiceName AppStderr (Join-Path $logsDir "service.err.log")
& $nssm set $ServiceName AppRotateFiles 1
& $nssm set $ServiceName AppRotateBytes 1048576

if (Test-Path $envFile) {
  & $nssm set $ServiceName AppEnvironmentExtra "DOTENV_CONFIG_PATH=$envFile"
}

Write-Host "Starting service..."
& $nssm start $ServiceName

Write-Host "Done. Service '$ServiceName' is installed and running."
Write-Host "Web UI: http://localhost:3847"
