#!/usr/bin/env bash
# Daily backup script for Steel ERP (production)
#
# Backs up BOTH:
#   1. PostgreSQL database (custom-format pg_dump | gzip)
#   2. Application uploads directory (tar.gz)
#
# Run via cron as root from /etc/cron.d/steel-erp-backup
# Uses peer authentication via 'sudo -u postgres pg_dump' (no password in script)
#
# Manual test:
#   sudo /opt/steel-erp/app/scripts/backup-db.sh
#
# References:
#   - production-safety.mdc §7 (Database safety)
#   - DEPLOYMENT.md §9 (Backups)

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
DB_NAME="${BACKUP_DB_NAME:-steel_erp_prod}"
DB_USER_PEER="${BACKUP_DB_USER:-postgres}"
UPLOADS_DIR="${BACKUP_UPLOADS_DIR:-/opt/steel-erp/app/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/opt/steel-erp/backups/daily}"
LOG_FILE="${BACKUP_LOG:-/var/log/steel-erp-backup.log}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
LOCK_FILE="/var/lock/steel-erp-backup.lock"
MIN_DB_SIZE_BYTES=1024     # below this, the DB dump is presumed broken
MIN_FREE_KB=524288         # 512 MB minimum free; below = refuse to run

# ─── Logging ──────────────────────────────────────────────────────────────────
log() {
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "[${ts}] $*" | tee -a "${LOG_FILE}"
}

fail() {
  log "ERROR: $*"
  log "=== Backup FAILED ==="
  exit 1
}

# ─── Pre-flight ───────────────────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}" "${BACKUP_DIR}/weekly"
touch "${LOG_FILE}"
chmod 640 "${LOG_FILE}" 2>/dev/null || true

# Single-instance lock (prevents overlapping runs)
exec 200>"${LOCK_FILE}"
flock -n 200 || fail "Another backup is already running (lock: ${LOCK_FILE})"

log "=== Backup started for database '${DB_NAME}' + uploads '${UPLOADS_DIR}' ==="

# Tooling availability
command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found in PATH"
command -v tar     >/dev/null 2>&1 || fail "tar not found in PATH"
command -v gzip    >/dev/null 2>&1 || fail "gzip not found in PATH"
id "${DB_USER_PEER}" >/dev/null 2>&1 || fail "User '${DB_USER_PEER}' does not exist"

# Verify DB exists
if ! sudo -u "${DB_USER_PEER}" psql -tAc \
        "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" \
        | grep -q 1; then
  fail "Database '${DB_NAME}' not found"
fi

# Disk space sanity check
AVAIL_KB=$(df -k "${BACKUP_DIR}" | awk 'NR==2 {print $4}')
if [ "${AVAIL_KB:-0}" -lt "${MIN_FREE_KB}" ]; then
  fail "Less than $((MIN_FREE_KB/1024)) MB free in $(dirname "${BACKUP_DIR}") — refusing to back up"
fi

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"

# ─── 1. PostgreSQL dump ───────────────────────────────────────────────────────
DUMP_FILE="${BACKUP_DIR}/db_${DB_NAME}_${TIMESTAMP}.dump.gz"
DUMP_TMP="${DUMP_FILE}.tmp"

log "[1/2] Dumping database to ${DUMP_FILE}"

# Custom format pg_dump, piped through gzip. Atomic rename via .tmp.
# pipefail (set -o) guarantees we catch a pg_dump failure even when piped.
if ! sudo -u "${DB_USER_PEER}" pg_dump --format=custom --no-owner --no-acl \
        --dbname="${DB_NAME}" 2>>"${LOG_FILE}" \
        | gzip -9 > "${DUMP_TMP}"; then
  rm -f "${DUMP_TMP}"
  fail "pg_dump pipeline failed"
fi

mv "${DUMP_TMP}" "${DUMP_FILE}"

# Verify DB dump
DUMP_SIZE=$(stat -c '%s' "${DUMP_FILE}")
DUMP_SIZE_MB=$(awk "BEGIN {printf \"%.2f\", ${DUMP_SIZE}/1048576}")

if [ "${DUMP_SIZE}" -lt "${MIN_DB_SIZE_BYTES}" ]; then
  fail "DB dump suspiciously small: ${DUMP_SIZE} bytes"
fi
if ! gunzip -t "${DUMP_FILE}" 2>>"${LOG_FILE}"; then
  fail "DB dump corrupted (gunzip -t failed)"
fi

log "[1/2] DB dump OK: ${DUMP_FILE} (${DUMP_SIZE_MB} MB)"

# ─── 2. Uploads archive ───────────────────────────────────────────────────────
UPLOADS_FILE="${BACKUP_DIR}/uploads_${TIMESTAMP}.tar.gz"
UPLOADS_TMP="${UPLOADS_FILE}.tmp"

if [ ! -d "${UPLOADS_DIR}" ]; then
  log "[2/2] WARNING: uploads dir '${UPLOADS_DIR}' does not exist — skipping uploads archive"
  UPLOADS_FILE=""
else
  log "[2/2] Archiving uploads from ${UPLOADS_DIR} -> ${UPLOADS_FILE}"

  # tar excludes any hidden tmp files; gzip -1 because PDFs/JPGs are already
  # compressed (high compression wastes CPU for ~1% gain). --owner=0 --group=0
  # keeps the archive deterministic so identical content produces identical
  # bytes (helps off-site dedup later).
  if ! tar --create \
           --gzip \
           --file="${UPLOADS_TMP}" \
           --directory="$(dirname "${UPLOADS_DIR}")" \
           --exclude='*.tmp' \
           --exclude='.DS_Store' \
           --owner=0 --group=0 --numeric-owner \
           --warning=no-file-changed \
           "$(basename "${UPLOADS_DIR}")" 2>>"${LOG_FILE}"; then
    # tar exits 1 on "file changed while reading" which is benign for live uploads.
    # We only fail if the tarball itself is missing or unreadable below.
    log "[2/2] tar reported non-zero (often benign 'file changed during read'); verifying integrity"
  fi

  if [ ! -s "${UPLOADS_TMP}" ]; then
    rm -f "${UPLOADS_TMP}"
    fail "Uploads tarball empty or missing after tar"
  fi

  if ! gzip -t "${UPLOADS_TMP}" 2>>"${LOG_FILE}"; then
    rm -f "${UPLOADS_TMP}"
    fail "Uploads tarball corrupted (gzip -t failed)"
  fi

  if ! tar -tzf "${UPLOADS_TMP}" >/dev/null 2>>"${LOG_FILE}"; then
    rm -f "${UPLOADS_TMP}"
    fail "Uploads tarball unreadable (tar -tzf failed)"
  fi

  mv "${UPLOADS_TMP}" "${UPLOADS_FILE}"

  UPL_SIZE=$(stat -c '%s' "${UPLOADS_FILE}")
  UPL_SIZE_MB=$(awk "BEGIN {printf \"%.2f\", ${UPL_SIZE}/1048576}")
  UPL_FILES=$(tar -tzf "${UPLOADS_FILE}" | wc -l)
  log "[2/2] Uploads archive OK: ${UPLOADS_FILE} (${UPL_SIZE_MB} MB, ${UPL_FILES} entries)"
fi

# ─── Weekly snapshot (Sunday) ─────────────────────────────────────────────────
DOW=$(date +%u)  # 1=Mon ... 7=Sun
if [ "${DOW}" = "7" ]; then
  WEEKLY_DB="${BACKUP_DIR}/weekly/db_${DB_NAME}_weekly_${TIMESTAMP}.dump.gz"
  cp -p "${DUMP_FILE}" "${WEEKLY_DB}"
  log "Weekly DB snapshot saved: ${WEEKLY_DB}"

  if [ -n "${UPLOADS_FILE}" ] && [ -f "${UPLOADS_FILE}" ]; then
    WEEKLY_UPL="${BACKUP_DIR}/weekly/uploads_weekly_${TIMESTAMP}.tar.gz"
    cp -p "${UPLOADS_FILE}" "${WEEKLY_UPL}"
    log "Weekly uploads snapshot saved: ${WEEKLY_UPL}"
  fi
fi

# ─── Prune old daily backups ──────────────────────────────────────────────────
log "Pruning daily backups older than ${KEEP_DAYS} days"
find "${BACKUP_DIR}" -maxdepth 1 -type f \
     \( -name "db_${DB_NAME}_*.dump.gz" -o -name "uploads_*.tar.gz" \) \
     -mtime "+${KEEP_DAYS}" -print -delete 2>>"${LOG_FILE}" \
     | while read -r removed; do
       log "Removed (daily): ${removed}"
     done

WEEKLY_KEEP_DAYS=$((KEEP_WEEKLY * 7))
log "Pruning weekly backups older than ${WEEKLY_KEEP_DAYS} days (${KEEP_WEEKLY} weeks)"
find "${BACKUP_DIR}/weekly" -maxdepth 1 -type f \
     \( -name "db_${DB_NAME}_weekly_*.dump.gz" -o -name "uploads_weekly_*.tar.gz" \) \
     -mtime "+${WEEKLY_KEEP_DAYS}" -print -delete 2>>"${LOG_FILE}" \
     | while read -r removed; do
       log "Removed (weekly): ${removed}"
     done

# ─── Summary ──────────────────────────────────────────────────────────────────
DB_COUNT=$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name "db_${DB_NAME}_*.dump.gz" | wc -l)
UPL_COUNT=$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name "uploads_*.tar.gz" | wc -l)
WEEKLY_DB_COUNT=$(find "${BACKUP_DIR}/weekly" -maxdepth 1 -type f -name "db_${DB_NAME}_weekly_*.dump.gz" 2>/dev/null | wc -l)
WEEKLY_UPL_COUNT=$(find "${BACKUP_DIR}/weekly" -maxdepth 1 -type f -name "uploads_weekly_*.tar.gz" 2>/dev/null | wc -l)
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" | awk '{print $1}')

log "Retained — daily: ${DB_COUNT} db / ${UPL_COUNT} uploads; weekly: ${WEEKLY_DB_COUNT} db / ${WEEKLY_UPL_COUNT} uploads; total size: ${TOTAL_SIZE}"
log "=== Backup completed successfully ==="

exit 0
