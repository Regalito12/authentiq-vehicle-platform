$ErrorActionPreference = "Stop"
$appRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $appRoot "server\.env"
$databaseLine = Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $databaseLine) { throw "No se encontró DATABASE_URL en server/.env" }
$databaseUrl = ($databaseLine -split "=", 2)[1].Trim()
$backupDir = Join-Path $appRoot "backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path $backupDir "authentiq-$stamp.dump"
& pg_dump --dbname=$databaseUrl --format=custom --file=$backupFile --no-owner --no-acl
if ($LASTEXITCODE -ne 0) { throw "pg_dump terminó con código $LASTEXITCODE" }
Write-Host "Backup creado: $backupFile"
