param(
  [string]$OutputDirectory = ".\backups",
  [string]$DatabaseUrl = $env:DATABASE_URL
)

if (-not $DatabaseUrl) { throw "Define DATABASE_URL antes de crear el backup." }
$resolvedOutput = Join-Path (Get-Location) $OutputDirectory
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $resolvedOutput "authentiq-$stamp.dump"
pg_dump $DatabaseUrl --format=custom --file=$target --no-owner --no-privileges
if ($LASTEXITCODE -ne 0) { throw "pg_dump no pudo crear el backup." }
Write-Host "Backup creado: $target"
