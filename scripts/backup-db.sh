#!/usr/bin/env bash
# Daily backup script for Steel ERP (production)
#
# Backs up BOTH:
#   1. PostgreSQL database (custom-format pg_dump | gzip)
#   2. Application uploads directory (tar.gz)
#
# And pushes both artifacts off-site to Backblaze B2 (via rclone) so the
# four-point verification required by production-safety.mdc §7 holds end to
# end (local file + size + gunzip -t + off-site presence).
#
# Run via cron as root from /etc/cron.d/steel-erp-backup, OR invoked by
# scripts/deploy.sh before every deploy (the deploy user has a dedicated
# sudoers entry — see DEPLOYMENT.md).
#
# Uses peer authentication via 'sudo -u postgres pg_dump' (no password here).
#
# Manual test:
#   sudo /opt/steel-erp/app/scripts/backup-db.sh
#
# Env knobs (override at the call site, NEVER hard-coded in the script):
#   BACKUP_DB_NAME       — defaults to steel_erp_prod
#   BACKUP_UPLOADS_DIR   — defaults to /opt/steel-erp/app/uploads
#   BACKUP_DIR           — defaults to /opt/steel-erp/backups/daily
#   BACKUP_KEEP_DAYS     — daily local + remote retention (default 7)
#   BACKUP_KEEP_WEEKLY   — weekly local + remote retention in weeks (default 4)
#   B2_REMOTE            — rclone remote prefix (default b2:steel-erp-backups)
#   SKIP_B2=1            — skip the off-site push (UAT/dev only — never prod)
#
# References:
#   - production-safety.mdc §7 (Database safety)
#   - DEPLOYMENT.md §9 (Backups)

set -euo pipefail

# ─── Optional credentials / overrides ────────────────────────────────────────
# Sourced before defaults so an operator can pin DB_NAME, B2_REMOTE, or
# RCLONE_CONFIG_* without editing this script. File MUST be chmod 600.
if [ -r /opt/steel-erp/scripts/.backup-env ]; then
  # shellcheck disable=SC1091
  source /opt/steel-erp/scripts/.backup-env
fi

# ─── Configuration ────────────────────────────────────────────────────────────
# Resolve which DB to back up (priority order):
#   1. BACKUP_DB_NAME env (explicit override — wins over everything)
#   2. DATABASE_URL in /opt/steel-erp/app/.env.production (auto-detect, so the
#      backup ALWAYS matches the DB the app actually talks to — this is what
#      caught us when DATABASE_URL was pointed at steel_erp_uat by mistake but
#      backup was still dumping steel_erp_prod)
#   3. Hard-coded fallback "steel_erp_prod"
APP_ENV_FILE="${BACKUP_APP_ENV_FILE:-/opt/steel-erp/app/.env.production}"
if [ -z "${BACKUP_DB_NAME:-}" ] && [ -r "${APP_ENV_FILE}" ]; then
  # Pull the DB name out of DATABASE_URL without echoing the full URL (no
  # secrets in logs). Strip surrounding quotes if any.
  BACKUP_DB_NAME=$(grep -E '^DATABASE_URL=' "${APP_ENV_FILE}" \
                   | head -1 \
                   | sed -E 's/^[^=]+=//; s/^"//; s/"$//' \
                   | grep -oE 'steel_erp_[a-z_]+' || true)
fi
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

# Off-site (Backblaze B2) configuration
B2_REMOTE="${B2_REMOTE:-b2:steel-erp-backups}"
B2_DAILY_PREFIX="${B2_DAILY_PREFIX:-daily}"
B2_WEEKLY_PREFIX="${B2_WEEKLY_PREFIX:-weekly}"
SKIP_B2="${SKIP_B2:-0}"

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

# Push a single local file to a B2 sub-prefix and verify it landed.
# Args: $1 = local path, $2 = remote sub-prefix (e.g. "daily" or "weekly").
# Honours SKIP_B2=1 by becoming a no-op (with a warning logged once).
push_to_b2() {
  local local_path="$1" prefix="$2"
  local key
  key=$(basename "${local_path}")

  if [ "${SKIP_B2}" = "1" ]; then
    log "SKIP_B2=1 — not uploading ${key} to ${B2_REMOTE}/${prefix}/"
    return 0
  fi

  log "Uploading ${key} -> ${B2_REMOTE}/${prefix}/"
  if ! rclone copy "${local_path}" "${B2_REMOTE}/${prefix}/" \
        --log-file="${LOG_FILE}" --log-level NOTICE 2>>"${LOG_FILE}"; then
    fail "rclone copy failed for ${local_path}"
  fi

  # Confirm landing — the same check deploy.sh does, so we never produce a
  # backup that deploy.sh would later reject.
  if ! rclone lsf "${B2_REMOTE}/${prefix}/" 2>>"${LOG_FILE}" | grep -Fxq "${key}"; then
    fail "Off-site verification failed: ${key} not visible at ${B2_REMOTE}/${prefix}/"
  fi
  log "Off-site OK: ${B2_REMOTE}/${prefix}/${key}"
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

# rclone is mandatory unless explicitly skipped (UAT/dev). Verifying off-site
# presence is one of the four points required to call a backup "verified".
if [ "${SKIP_B2}" != "1" ]; then
  command -v rclone >/dev/null 2>&1 \
    || fail "rclone not found — install + configure remote '${B2_REMOTE%%:*}', or set SKIP_B2=1 (NEVER in production)"
  if ! rclone listremotes 2>/dev/null | grep -Fxq "${B2_REMOTE%%:*}:"; then
    fail "rclone remote '${B2_REMOTE%%:*}:' is not configured (run 'rclone config'). Refusing to back up without an off-site target."
  fi
else
  log "WARNING: SKIP_B2=1 — off-site verification disabled. DO NOT use in production."
fi

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

push_to_b2 "${DUMP_FILE}" "${B2_DAILY_PREFIX}"

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

  push_to_b2 "${UPLOADS_FILE}" "${B2_DAILY_PREFIX}"
fi

# ─── Weekly snapshot (Sunday) ─────────────────────────────────────────────────
DOW=$(date +%u)  # 1=Mon ... 7=Sun
if [ "${DOW}" = "7" ]; then
  WEEKLY_DB="${BACKUP_DIR}/weekly/db_${DB_NAME}_weekly_${TIMESTAMP}.dump.gz"
  cp -p "${DUMP_FILE}" "${WEEKLY_DB}"
  log "Weekly DB snapshot saved: ${WEEKLY_DB}"
  push_to_b2 "${WEEKLY_DB}" "${B2_WEEKLY_PREFIX}"

  if [ -n "${UPLOADS_FILE}" ] && [ -f "${UPLOADS_FILE}" ]; then
    WEEKLY_UPL="${BACKUP_DIR}/weekly/uploads_weekly_${TIMESTAMP}.tar.gz"
    cp -p "${UPLOADS_FILE}" "${WEEKLY_UPL}"
    log "Weekly uploads snapshot saved: ${WEEKLY_UPL}"
    push_to_b2 "${WEEKLY_UPL}" "${B2_WEEKLY_PREFIX}"
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

# ─── Prune off-site (B2) with the same retention windows ─────────────────────
if [ "${SKIP_B2}" != "1" ]; then
  log "Pruning off-site daily older than ${KEEP_DAYS}d at ${B2_REMOTE}/${B2_DAILY_PREFIX}/"
  rclone delete "${B2_REMOTE}/${B2_DAILY_PREFIX}/" \
    --min-age "${KEEP_DAYS}d" \
    --log-file="${LOG_FILE}" --log-level NOTICE 2>>"${LOG_FILE}" \
    || log "WARNING: rclone delete (daily) returned non-zero — investigate"

  log "Pruning off-site weekly older than ${WEEKLY_KEEP_DAYS}d at ${B2_REMOTE}/${B2_WEEKLY_PREFIX}/"
  rclone delete "${B2_REMOTE}/${B2_WEEKLY_PREFIX}/" \
    --min-age "${WEEKLY_KEEP_DAYS}d" \
    --log-file="${LOG_FILE}" --log-level NOTICE 2>>"${LOG_FILE}" \
    || log "WARNING: rclone delete (weekly) returned non-zero — investigate"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
DB_COUNT=$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name "db_${DB_NAME}_*.dump.gz" | wc -l)
UPL_COUNT=$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name "uploads_*.tar.gz" | wc -l)
WEEKLY_DB_COUNT=$(find "${BACKUP_DIR}/weekly" -maxdepth 1 -type f -name "db_${DB_NAME}_weekly_*.dump.gz" 2>/dev/null | wc -l)
WEEKLY_UPL_COUNT=$(find "${BACKUP_DIR}/weekly" -maxdepth 1 -type f -name "uploads_weekly_*.tar.gz" 2>/dev/null | wc -l)
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" | awk '{print $1}')

log "Retained — daily: ${DB_COUNT} db / ${UPL_COUNT} uploads; weekly: ${WEEKLY_DB_COUNT} db / ${WEEKLY_UPL_COUNT} uploads; total size: ${TOTAL_SIZE}"
if [ "${SKIP_B2}" = "1" ]; then
  log "Off-site: SKIPPED (SKIP_B2=1)"
else
  log "Off-site: pushed to ${B2_REMOTE}/${B2_DAILY_PREFIX}/ and verified"
fi
log "=== Backup completed successfully ==="

exit 0
