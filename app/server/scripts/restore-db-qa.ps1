param(
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [string]$QaDatabaseUrl = $env:QA_DATABASE_URL
)

$ErrorActionPreference = "Stop"

if ($env:QA_ENVIRONMENT -ne "qa" -or $env:ZEVROA_QA_CONFIRMATION -ne "zevroa-qa") {
  throw "La restauración exige QA_ENVIRONMENT=qa y ZEVROA_QA_CONFIRMATION=zevroa-qa."
}
if ($env:NODE_ENV -eq "production") { throw "No se puede restaurar con NODE_ENV=production." }
if (-not $QaDatabaseUrl) { throw "Define QA_DATABASE_URL; nunca uses DATABASE_URL para restaurar QA." }
if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) { throw "No se encontró el backup indicado." }
if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) { throw "pg_restore no está disponible en PATH." }

$QaDatabaseUrl = $QaDatabaseUrl.Trim().Trim('"').Trim("'")
if ($QaDatabaseUrl -match "(?i)(^|[/:.])zevroa\.com(:|/|$)") { throw "La URL indicada parece producción; se cancela la restauración." }

pg_restore --clean --if-exists --no-owner --dbname=$QaDatabaseUrl $BackupFile
if ($LASTEXITCODE -ne 0) { throw "pg_restore no pudo completar la restauración QA." }
Write-Host "QA DATABASE RESTORE PASS · restauración terminada. Verifica login, conteos y Storage antes de usar QA."
