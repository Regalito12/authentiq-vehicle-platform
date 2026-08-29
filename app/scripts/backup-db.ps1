param(
  [switch]$Verify,
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
$appRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $appRoot "server\.env"
$databaseLine = Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $databaseLine) { throw "No se encontró DATABASE_URL en server/.env" }
$databaseUrl = ($databaseLine -split "=", 2)[1].Trim()
$backupDir = if ($OutputDirectory) { $OutputDirectory } else { Join-Path $appRoot "backups" }
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path $backupDir "zevroa-$stamp.dump"
& pg_dump --dbname=$databaseUrl --format=custom --file=$backupFile --no-owner --no-acl
if ($LASTEXITCODE -ne 0) { throw "pg_dump terminó con código $LASTEXITCODE" }

if ($Verify) {
  $restoreTool = Get-Command pg_restore -ErrorAction SilentlyContinue
  if (-not $restoreTool) { throw "No se encontró pg_restore para validar el backup." }
  & pg_restore --list $backupFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "pg_restore no pudo leer el backup (código $LASTEXITCODE)" }
  if ((Get-Item -LiteralPath $backupFile).Length -lt 1024) { throw "El backup es demasiado pequeño para considerarlo válido." }
  Write-Host "Backup verificado: $backupFile"
} else {
  Write-Host "Backup creado: $backupFile"
}
