param(
  [string]$OutputDirectory = ".\backups",
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [switch]$Verify,
  [switch]$QA
)

$ErrorActionPreference = "Stop"

if ($QA) {
  if ($env:QA_ENVIRONMENT -ne "qa" -or $env:ZEVROA_QA_CONFIRMATION -ne "zevroa-qa") {
    throw "El backup QA exige QA_ENVIRONMENT=qa y ZEVROA_QA_CONFIRMATION=zevroa-qa."
  }
  if ($env:NODE_ENV -eq "production") { throw "No se puede ejecutar un backup QA con NODE_ENV=production." }
  $DatabaseUrl = $env:QA_DATABASE_URL
}
if (-not $DatabaseUrl) { throw "Define DATABASE_URL antes de crear el backup." }
if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) { throw "pg_dump no está disponible en PATH." }

# `vercel env pull` puede envolver valores con comillas para proteger caracteres
# especiales. Se retiran solo las comillas exteriores; el secreto nunca se muestra.
$DatabaseUrl = $DatabaseUrl.Trim()
if (($DatabaseUrl.StartsWith('"') -and $DatabaseUrl.EndsWith('"')) -or ($DatabaseUrl.StartsWith("'") -and $DatabaseUrl.EndsWith("'"))) {
  $DatabaseUrl = $DatabaseUrl.Substring(1, $DatabaseUrl.Length - 2)
}
if ($QA -and $DatabaseUrl -match "(?i)(^|[/:.])zevroa\.com(:|/|$)") { throw "La URL indicada parece producción; se cancela el backup QA." }

# La aplicación usa Supavisor en modo transaction (6543) para no agotar
# conexiones serverless. pg_dump necesita una sesión persistente; cambia solo
# el pooler de Supabase a su puerto de sesión (5432), sin imprimir la URL.
try {
  $databaseUri = [UriBuilder]$DatabaseUrl
  if ($databaseUri.Host -match '(?i)pooler\.supabase\.com$' -and $databaseUri.Port -eq 6543) {
    $databaseUri.Port = 5432
    $DatabaseUrl = $databaseUri.Uri.AbsoluteUri
  }
} catch {
  throw "DATABASE_URL no tiene un formato válido para backup."
}

$resolvedOutput = if ([IO.Path]::IsPathRooted($OutputDirectory)) {
  [IO.Path]::GetFullPath($OutputDirectory)
} else {
  Join-Path (Get-Location) $OutputDirectory
}
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $resolvedOutput "zevroa-$stamp.dump"
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
$manifestPath = Join-Path $resolvedOutput "zevroa-$stamp.manifest.json"
$manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
if ($Verify) {
  if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) { throw "pg_restore no está disponible para verificar el backup." }
  pg_restore --list $target | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "pg_restore no pudo leer el backup creado." }
}
Write-Host "Backup creado: $target"
Write-Host "SHA256: $hash"
if ($Verify) { Write-Host "Verificación pg_restore: OK" }
