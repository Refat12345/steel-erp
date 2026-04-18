# PostgreSQL restore script for Steel ERP
#
# Usage:
#   .\scripts\restore-db.ps1 -BackupFile ".\backups\steel_erp_2026-04-16_020000.sql"
#
# WARNING: This drops and recreates the target database!
# Always verify the backup file before restoring in production.

param(
    [Parameter(Mandatory=$true)]
    [string]$BackupFile
)

$ErrorActionPreference = "Stop"

$DB_NAME = $env:BACKUP_DB_NAME ?? "steel_erp"
$DB_USER = $env:BACKUP_DB_USER ?? "postgres"
$DB_HOST = $env:BACKUP_DB_HOST ?? "localhost"
$DB_PORT = $env:BACKUP_DB_PORT ?? "5432"

if (-not (Test-Path $BackupFile)) {
    Write-Error "Backup file not found: $BackupFile"
    exit 1
}

$size = (Get-Item $BackupFile).Length / 1MB
Write-Host "[$(Get-Date)] Restoring from: $BackupFile ($([math]::Round($size, 2)) MB)"
Write-Host ""
Write-Host "WARNING: This will DROP the database '$DB_NAME' and recreate it." -ForegroundColor Red
Write-Host "Press Ctrl+C to abort, or any key to continue..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

Write-Host ""
Write-Host "[$(Get-Date)] Terminating active connections..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" 2>$null

Write-Host "[$(Get-Date)] Dropping database..."
dropdb -h $DB_HOST -p $DB_PORT -U $DB_USER --if-exists $DB_NAME

Write-Host "[$(Get-Date)] Creating database..."
createdb -h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME

Write-Host "[$(Get-Date)] Restoring data..."
pg_restore -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME --no-owner --no-privileges $BackupFile

if ($LASTEXITCODE -ne 0) {
    Write-Error "pg_restore failed with exit code $LASTEXITCODE"
    exit 1
}

Write-Host "[$(Get-Date)] Restore complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Restart the application (PM2 or dev server)"
Write-Host "  2. Verify data at http://localhost:3000"
