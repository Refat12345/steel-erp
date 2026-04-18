# Verify a Steel ERP backup by restoring to a temporary database,
# checking key tables, and then dropping the temp DB.
#
# Usage:
#   .\scripts\verify-backup.ps1 -BackupFile ".\backups\steel_erp_2026-04-16_020000.sql"
#
# This does NOT affect the production database.

param(
    [Parameter(Mandatory=$true)]
    [string]$BackupFile
)

$ErrorActionPreference = "Stop"

$DB_USER = $env:BACKUP_DB_USER ?? "postgres"
$DB_HOST = $env:BACKUP_DB_HOST ?? "localhost"
$DB_PORT = $env:BACKUP_DB_PORT ?? "5432"
$TEMP_DB = "steel_erp_verify_$(Get-Date -Format 'yyyyMMddHHmmss')"

if (-not (Test-Path $BackupFile)) {
    Write-Error "Backup file not found: $BackupFile"
    exit 1
}

$size = (Get-Item $BackupFile).Length / 1MB
Write-Host "[$(Get-Date)] Verifying backup: $BackupFile ($([math]::Round($size, 2)) MB)"
Write-Host "[$(Get-Date)] Creating temp database: $TEMP_DB"

try {
    createdb -h $DB_HOST -p $DB_PORT -U $DB_USER $TEMP_DB

    Write-Host "[$(Get-Date)] Restoring into temp database..."
    pg_restore -h $DB_HOST -p $DB_PORT -U $DB_USER -d $TEMP_DB --no-owner --no-privileges $BackupFile 2>$null

    Write-Host "[$(Get-Date)] Checking key tables..."
    $tables = @("users", "roles", "permissions", "truck_operations", "weigh_sessions", "audit_logs", "customers")
    $allOk = $true

    foreach ($table in $tables) {
        $count = psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $TEMP_DB -t -c "SELECT COUNT(*) FROM $table;" 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  FAIL: $table (table missing or error)" -ForegroundColor Red
            $allOk = $false
        } else {
            $count = $count.Trim()
            Write-Host "  OK: $table ($count rows)" -ForegroundColor Green
        }
    }

    if ($allOk) {
        Write-Host ""
        Write-Host "[$(Get-Date)] BACKUP VERIFIED SUCCESSFULLY" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "[$(Get-Date)] BACKUP VERIFICATION HAD WARNINGS" -ForegroundColor Yellow
    }
} finally {
    Write-Host "[$(Get-Date)] Dropping temp database: $TEMP_DB"
    dropdb -h $DB_HOST -p $DB_PORT -U $DB_USER --if-exists $TEMP_DB 2>$null
}
