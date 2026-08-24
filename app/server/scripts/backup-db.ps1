param(
  [string]$OutputDirectory = ".\backups",
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [switch]$Verify
)

$ErrorActionPreference = "Stop"

if (-not $DatabaseUrl) { throw "Define DATABASE_URL antes de crear el backup." }
if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) { throw "pg_dump no está disponible en PATH." }
$resolvedOutput = Join-Path (Get-Location) $OutputDirectory
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $resolvedOutput "authentiq-$stamp.dump"
pg_dump $DatabaseUrl --format=custom --file=$target --no-owner --no-privileges
if ($LASTEXITCODE -ne 0) { throw "pg_dump no pudo crear el backup." }
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$stream = [System.IO.File]::OpenRead($target)
try {
  $hash = ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
} finally {
  $stream.Dispose()
  $sha256.Dispose()
}
$manifest = [ordered]@{
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  file = [IO.Path]::GetFileName($target)
  sizeBytes = (Get-Item -LiteralPath $target).Length
  sha256 = $hash
}
$manifestPath = Join-Path $resolvedOutput "authentiq-$stamp.manifest.json"
$manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
if ($Verify) {
  if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) { throw "pg_restore no está disponible para verificar el backup." }
  pg_restore --list $target | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "pg_restore no pudo leer el backup creado." }
}
Write-Host "Backup creado: $target"
Write-Host "SHA256: $hash"
if ($Verify) { Write-Host "Verificación pg_restore: OK" }
