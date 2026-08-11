$ErrorActionPreference = "Stop"
$appRoot = Split-Path -Parent $PSScriptRoot

function Test-LocalPort([int]$port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

if (-not (Test-LocalPort 3001)) {
  Start-Process -FilePath "node.exe" -ArgumentList @("server/src/index.js") -WorkingDirectory $appRoot -WindowStyle Hidden | Out-Null
  Write-Host "API iniciada en http://127.0.0.1:3001"
} else {
  Write-Host "API ya estaba activa en http://127.0.0.1:3001"
}

if (-not (Test-LocalPort 5173)) {
  Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1") -WorkingDirectory $appRoot -WindowStyle Hidden | Out-Null
  Write-Host "Frontend iniciándose en http://127.0.0.1:5173"
} else {
  Write-Host "Frontend ya estaba activo en http://127.0.0.1:5173"
}

Write-Host "Abre http://127.0.0.1:5173/"
