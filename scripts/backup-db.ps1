# Daily PostgreSQL backup script for Steel ERP
#
# To schedule via PowerShell (run as Administrator):
#
#   $action  = New-ScheduledTaskAction -Execute "powershell.exe" `
#                -Argument '-ExecutionPolicy Bypass -File "C:\Users\USR25\steel-erp\scripts\backup-db.ps1"'
#   $trigger = New-ScheduledTaskTrigger -Daily -At "02:00"
#   Register-ScheduledTask -TaskName "SteelERP-DailyBackup" `
#                          -Action $action -Trigger $trigger `
#                          -RunLevel Highest -User "SYSTEM"
#
# To test: Run this script manually first, then verify with verify-backup.ps1

$ErrorActionPreference = "Stop"

# ─── Configuration ─────────────────────────────────────────────────
$DB_NAME     = $env:BACKUP_DB_NAME    ?? "steel_erp"
$DB_USER     = $env:BACKUP_DB_USER    ?? "postgres"
$DB_HOST     = $env:BACKUP_DB_HOST    ?? "localhost"
$DB_PORT     = $env:BACKUP_DB_PORT    ?? "5432"
$BACKUP_DIR  = $env:BACKUP_DIR        ?? (Join-Path $PSScriptRoot "..\backups")
$KEEP_DAYS   = 30

# ─── Create backup directory ──────────────────────────────────────
if (-not (Test-Path $BACKUP_DIR)) {
    New-Item -ItemType Directory -Path $BACKUP_DIR -Force | Out-Null
}

# ─── Run pg_dump ──────────────────────────────────────────────────
$timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$filename  = "steel_erp_${timestamp}.dump"
$filepath  = Join-Path $BACKUP_DIR $filename

Write-Host "[$(Get-Date)] Starting backup: $filename"

pg_dump -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -F c -f $filepath

if ($LASTEXITCODE -ne 0) {
    Write-Error "pg_dump failed with exit code $LASTEXITCODE"
    exit 1
}

$size = (Get-Item $filepath).Length / 1MB
Write-Host "[$(Get-Date)] Backup complete: $filename ($([math]::Round($size, 2)) MB)"

# ─── Prune old backups ────────────────────────────────────────────
$cutoff = (Get-Date).AddDays(-$KEEP_DAYS)
Get-ChildItem $BACKUP_DIR -Filter "steel_erp_*.*" |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
        Write-Host "[$(Get-Date)] Removing old backup: $($_.Name)"
        Remove-Item $_.FullName
    }

Write-Host "[$(Get-Date)] Backup job finished."
