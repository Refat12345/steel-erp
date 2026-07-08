#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# steel-erp production deploy script
#
# Location on server:
#   This file is committed at scripts/deploy.sh inside the repo.
#   On first install, symlink it from outside the app dir so it survives
#   `git reset --hard` during a rollback:
#
#     ln -sf /opt/steel-erp/app/scripts/deploy.sh /opt/steel-erp/scripts/deploy.sh
#     chmod +x /opt/steel-erp/app/scripts/deploy.sh
#
# Usage:
#   /opt/steel-erp/scripts/deploy.sh deploy    # normal deploy (default)
#   /opt/steel-erp/scripts/deploy.sh rollback  # roll back to previous SHA
#   FORCE=1 /opt/steel-erp/scripts/deploy.sh deploy   # bypass maintenance window
#
# Refer to .cursor/rules/production-safety.mdc and DEPLOYMENT.md.
# ---------------------------------------------------------------------------

set -euo pipefail

# --- Config ----------------------------------------------------------------

APP_DIR="/opt/steel-erp/app"
STATE_DIR="/opt/steel-erp/state"
# Single source of truth: scripts/backup-db.sh in this repo. It produces the
# DB dump (pushed off-site to B2 daily/) and the uploads tarball (verified
# locally; uploads go off-site via a differential rclone mirror at
# uploads-mirror/ rather than as a daily tarball).
# We invoke it via `sudo -n` because backup-db.sh internally uses
# `sudo -u postgres pg_dump`. See DEPLOYMENT.md for the sudoers.d entry.
BACKUP_SCRIPT="${APP_DIR}/scripts/backup-db.sh"
LOCAL_BACKUP_DIR="/opt/steel-erp/backups/daily"
B2_REMOTE="b2:steel-erp-backups"
B2_DAILY_PREFIX="daily"
B2_UPLOADS_MIRROR_PREFIX="uploads-mirror"
LOCK_FILE="/var/lock/steel-erp-deploy.lock"
LOG_FILE="/var/log/steel-erp-deploy.log"
CHANGES_FILE="/opt/steel-erp/CHANGES.md"
PM2_APP_NAME="steel-erp"
HEALTH_URL="http://localhost:3000/api/health"

MIN_DISK_FREE_MB=2048           # require ≥ 2 GB free on /
MIN_RAM_FREE_MB=300             # require ≥ 300 MB available RAM
# Sanity floor for the DB dump: catches an obviously-broken pg_dump (zero
# bytes, header-only, etc.) without rejecting a legitimately small early-
# launch DB. backup-db.sh has its own 1 KB floor, so this is the second
# layer. Override with MIN_BACKUP_BYTES=… for environments that should
# enforce a stricter minimum (e.g. mature production with known-large data).
MIN_BACKUP_BYTES="${MIN_BACKUP_BYTES:-$((10 * 1024))}"
HEALTH_RETRIES=2
HEALTH_RETRY_SLEEP=30
NODE_BUILD_HEAP_MB=1024         # cap `next build` heap to fit KVM 2

MAINT_START_HOUR=7              # 07:00 Asia/Damascus
MAINT_END_HOUR=18               # 18:00 Asia/Damascus

# --- Helpers ---------------------------------------------------------------

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S%z')" "$*" | tee -a "$LOG_FILE"
}

die() {
  log "ERROR: $*"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

acquire_lock() {
  exec 9>"$LOCK_FILE" || die "Cannot open lock file $LOCK_FILE"
  if ! flock -n 9; then
    die "Another deploy is already running (lock held on $LOCK_FILE)"
  fi
}

check_business_hours() {
  if [ "${FORCE:-0}" = "1" ]; then
    log "FORCE=1 set — skipping maintenance-window check"
    return 0
  fi
  local hour
  hour=$(TZ=Asia/Damascus date +%-H)
  if [ "$hour" -ge "$MAINT_START_HOUR" ] && [ "$hour" -lt "$MAINT_END_HOUR" ]; then
    die "Refusing to deploy during business hours (${MAINT_START_HOUR}:00–${MAINT_END_HOUR}:00 Asia/Damascus). Re-run with FORCE=1 if this is an emergency."
  fi
}

check_preflight() {
  log "Pre-flight checks"

  [ -d "$APP_DIR/.git" ] || die "$APP_DIR is not a git checkout"
  [ -x "$BACKUP_SCRIPT" ] || die "Backup script not found or not executable: $BACKUP_SCRIPT"
  require_cmd git
  require_cmd npm
  require_cmd node
  require_cmd pm2
  require_cmd curl
  require_cmd rclone
  require_cmd flock
  require_cmd sudo
  require_cmd jq

  # We need passwordless sudo for backup-db.sh specifically. Verify up front
  # so we fail in pre-flight rather than in the middle of run_backup_and_verify.
  sudo -n -l "$BACKUP_SCRIPT" >/dev/null 2>&1 \
    || die "Missing sudoers entry for $(whoami) to run $BACKUP_SCRIPT (see DEPLOYMENT.md)"

  cd "$APP_DIR"

  # Working tree must be clean — no surprise local edits.
  if [ -n "$(git status --porcelain)" ]; then
    git status --short | tee -a "$LOG_FILE"
    die "Working tree at $APP_DIR is not clean. Resolve manually before deploying."
  fi

  local current_branch
  current_branch=$(git rev-parse --abbrev-ref HEAD)
  [ "$current_branch" = "main" ] || die "Refusing to deploy: current branch is '$current_branch', expected 'main'"

  # Disk space.
  local disk_free_mb
  disk_free_mb=$(df -BM --output=avail / | tail -1 | tr -dc '0-9')
  [ "$disk_free_mb" -ge "$MIN_DISK_FREE_MB" ] \
    || die "Disk too full: ${disk_free_mb}M free on / (need ≥ ${MIN_DISK_FREE_MB}M)"

  # RAM (uses MemAvailable from /proc/meminfo — the realistic metric).
  local ram_free_mb
  ram_free_mb=$(awk '/MemAvailable:/ {print int($2/1024)}' /proc/meminfo)
  [ "$ram_free_mb" -ge "$MIN_RAM_FREE_MB" ] \
    || die "Available RAM too low: ${ram_free_mb}M (need ≥ ${MIN_RAM_FREE_MB}M)"

  # PM2 must currently report the app as online so we have a known baseline.
  # Status lives at .pm2_env.status in `pm2 jlist`, not at the top level —
  # parse the JSON properly via jq instead of fragile sed.
  local pm2_jlist pm2_status
  pm2_jlist=$(pm2 jlist 2>/dev/null) || die "pm2 jlist failed"

  if ! printf '%s' "$pm2_jlist" | jq -e --arg n "$PM2_APP_NAME" \
        'any(.[]; .name == $n)' >/dev/null; then
    die "PM2 has no app named '$PM2_APP_NAME' — start it manually first"
  fi

  pm2_status=$(printf '%s' "$pm2_jlist" | jq -r --arg n "$PM2_APP_NAME" \
                 '[.[] | select(.name == $n)] | first | .pm2_env.status // empty')
  [ "$pm2_status" = "online" ] \
    || die "PM2 reports '$PM2_APP_NAME' as '${pm2_status:-<unknown>}' (expected 'online'). Investigate before deploying."

  log "Pre-flight OK (disk=${disk_free_mb}M, ram=${ram_free_mb}M, branch=$current_branch)"
}

run_backup_and_verify() {
  log "Running backup before deploy ($BACKUP_SCRIPT via sudo)"
  sudo -n "$BACKUP_SCRIPT" >> "$LOG_FILE" 2>&1 \
    || die "Backup script failed — see $LOG_FILE"

  # Locate the most recent DB dump produced by this run.
  BACKUP_FILE_DB=$(ls -1t "$LOCAL_BACKUP_DIR"/db_*.dump.gz 2>/dev/null | head -1 || true)
  [ -n "$BACKUP_FILE_DB" ] || die "No DB dump found in $LOCAL_BACKUP_DIR"
  [ -s "$BACKUP_FILE_DB" ] || die "DB dump is empty: $BACKUP_FILE_DB"

  local db_size
  db_size=$(stat -c '%s' "$BACKUP_FILE_DB")
  [ "$db_size" -ge "$MIN_BACKUP_BYTES" ] \
    || die "DB dump unrealistically small: ${db_size} bytes (floor: ${MIN_BACKUP_BYTES})"

  gunzip -t "$BACKUP_FILE_DB" \
    || die "DB dump gzip integrity check failed: $BACKUP_FILE_DB"

  B2_KEY_DB=$(basename "$BACKUP_FILE_DB")
  rclone lsf "${B2_REMOTE}/${B2_DAILY_PREFIX}/" 2>/dev/null | grep -Fxq "$B2_KEY_DB" \
    || die "DB dump not found off-site at ${B2_REMOTE}/${B2_DAILY_PREFIX}/${B2_KEY_DB}"

  log "DB dump verified: $BACKUP_FILE_DB (${db_size} bytes, off-site OK)"

  # Locate the matching uploads tarball. backup-db.sh produces it with the
  # SAME timestamp as the DB dump, so we extract that timestamp and look
  # for the exact pair instead of just "the newest" (which could mismatch
  # if anything wrote to the dir concurrently).
  local ts
  ts=$(basename "$BACKUP_FILE_DB" | sed -nE 's/^db_[A-Za-z0-9_]+_([0-9]{8}-[0-9]{6})\.dump\.gz$/\1/p')
  [ -n "$ts" ] || die "Could not parse timestamp from $BACKUP_FILE_DB"

  BACKUP_FILE_UPLOADS="${LOCAL_BACKUP_DIR}/uploads_${ts}.tar.gz"
  if [ -s "$BACKUP_FILE_UPLOADS" ]; then
    local upl_size
    upl_size=$(stat -c '%s' "$BACKUP_FILE_UPLOADS")
    gunzip -t "$BACKUP_FILE_UPLOADS" \
      || die "Uploads tarball gzip integrity check failed: $BACKUP_FILE_UPLOADS"

    B2_KEY_UPLOADS=$(basename "$BACKUP_FILE_UPLOADS")

    # Uploads go off-site as a differential mirror (backup-db.sh runs
    # `rclone sync` and fails the whole backup on any sync/count mismatch).
    # Here we only confirm the mirror prefix is reachable — the strict
    # local-vs-mirror file-count check already happened inside backup-db.sh.
    local mirror_count
    mirror_count=$(rclone size "${B2_REMOTE}/${B2_UPLOADS_MIRROR_PREFIX}/" --json 2>/dev/null \
                   | jq -r '.count // empty') \
      || die "Could not query uploads mirror at ${B2_REMOTE}/${B2_UPLOADS_MIRROR_PREFIX}/"
    [ -n "$mirror_count" ] \
      || die "Uploads mirror unreadable at ${B2_REMOTE}/${B2_UPLOADS_MIRROR_PREFIX}/"

    log "Uploads archive verified: $BACKUP_FILE_UPLOADS (${upl_size} bytes local); mirror OK (${mirror_count} files at ${B2_REMOTE}/${B2_UPLOADS_MIRROR_PREFIX}/)"
  else
    # backup-db.sh logs a WARNING when uploads dir doesn't exist; mirror it
    # here so the deploy log itself records the absence (no silent gap).
    log "WARNING: uploads tarball uploads_${ts}.tar.gz not present — backup-db.sh skipped uploads (uploads dir missing?)"
    BACKUP_FILE_UPLOADS=""
    B2_KEY_UPLOADS=""
  fi

  # Backwards-compat aliases for any consumer still reading the old names.
  BACKUP_FILE="$BACKUP_FILE_DB"
  B2_KEY="$B2_KEY_DB"
}

snapshot_pre_state() {
  mkdir -p "$STATE_DIR"
  cd "$APP_DIR"
  PREV_SHA=$(git rev-parse HEAD)
  pm2 jlist > "$STATE_DIR/pm2-pre-${PREV_SHA}.json" 2>/dev/null || true

  # Shell-sourceable state file. Keep it flat and key=value for portability
  # (no jq dependency). Do NOT put secrets here.
  # BACKUP_FILE / B2_KEY remain as aliases of the DB pair for any older tooling
  # that reads them; new tooling should prefer the *_DB / *_UPLOADS keys.
  cat > "$STATE_DIR/last-pre-deploy.env" <<EOF
PREV_SHA="$PREV_SHA"
BACKUP_FILE_DB="$BACKUP_FILE_DB"
BACKUP_FILE_UPLOADS="${BACKUP_FILE_UPLOADS:-}"
B2_KEY_DB="$B2_KEY_DB"
B2_KEY_UPLOADS="${B2_KEY_UPLOADS:-}"
B2_REMOTE="$B2_REMOTE"
B2_DAILY_PREFIX="$B2_DAILY_PREFIX"
BACKUP_FILE="$BACKUP_FILE_DB"
B2_KEY="$B2_KEY_DB"
PM2_PRE_STATE="$STATE_DIR/pm2-pre-${PREV_SHA}.json"
DEPLOY_USER="$(whoami)"
DEPLOY_START="$(date -Iseconds)"
EOF
  chmod 600 "$STATE_DIR/last-pre-deploy.env"
  log "Snapshotted pre-deploy state at SHA $PREV_SHA"
}

migration_files_added() {
  # Returns 0 if any new migration directories appear between PREV_SHA and HEAD.
  cd "$APP_DIR"
  if ! git diff --name-only "$PREV_SHA" HEAD -- "prisma/migrations/" | grep -q .; then
    return 1
  fi
  return 0
}

health_check() {
  local body status
  body=$(curl -sf --max-time 5 "$HEALTH_URL" 2>/dev/null || true)
  [ -n "$body" ] || return 1
  echo "$body" | grep -q '"dbConnected":true'
}

wait_for_health() {
  local i=0
  while [ "$i" -lt "$HEALTH_RETRIES" ]; do
    if health_check; then
      log "Health check OK"
      return 0
    fi
    i=$((i + 1))
    log "Health check attempt $i/$HEALTH_RETRIES failed — sleeping ${HEALTH_RETRY_SLEEP}s"
    sleep "$HEALTH_RETRY_SLEEP"
  done
  return 1
}

append_changes() {
  local action="$1" result="$2" rollback_hint="$3"
  {
    printf '\n## %s\n' "$(TZ=Asia/Damascus date '+%Y-%m-%d %H:%M %Z')"
    printf -- '- Action: %s\n' "$action"
    printf -- '- Reason: scheduled deploy by %s\n' "$(whoami)"
    printf -- '- Commands: deploy.sh deploy (PREV_SHA=%s NEW_SHA=%s)\n' "${PREV_SHA:-?}" "${NEW_SHA:-?}"
    printf -- '- Result: %s\n' "$result"
    printf -- '- Rollback: %s\n' "$rollback_hint"
  } >> "$CHANGES_FILE"
}

on_error() {
  local exit_code=$? line=${1:-?}
  log "Deploy failed at line $line (exit $exit_code)"

  if [ -n "${PREV_SHA:-}" ] && [ -n "${NEW_SHA:-}" ] && [ "$NEW_SHA" != "$PREV_SHA" ]; then
    log "Reverting working tree to $PREV_SHA"
    cd "$APP_DIR"
    git reset --hard "$PREV_SHA" >> "$LOG_FILE" 2>&1 || log "git reset failed — manual fix required"

    # If we already reloaded PM2 onto the bad code, reload again on the
    # restored tree to bring the app back. Best effort.
    if [ "${PM2_RELOADED:-0}" = "1" ]; then
      log "Rebuilding restored code and reloading PM2"
      ( npm ci && NODE_OPTIONS="--max-old-space-size=${NODE_BUILD_HEAP_MB}" npm run build && pm2 reload "$PM2_APP_NAME" ) \
        >> "$LOG_FILE" 2>&1 || log "Rollback rebuild failed — INVESTIGATE NOW"
    fi

    if [ "${MIGRATIONS_APPLIED:-0}" = "1" ]; then
      log "WARNING: Prisma migrations were applied during this deploy."
      log "Code has been reverted but the DB schema is on the new version."
      log "If the new code expected the new schema and you need to roll back the DB:"
      log "  1. pm2 stop $PM2_APP_NAME"
      log "  2. pg_restore -U steel_erp -d steel_erp_prod -h localhost --clean --no-owner --no-acl <(gunzip -c ${BACKUP_FILE_DB:-<MISSING>})"
      if [ -n "${BACKUP_FILE_UPLOADS:-}" ]; then
        log "  3. (uploads) sudo tar -xzf ${BACKUP_FILE_UPLOADS} -C ${APP_DIR}"
        log "  4. pm2 start $PM2_APP_NAME"
      else
        log "  3. pm2 start $PM2_APP_NAME"
      fi
      log "See docs/DISASTER-RECOVERY.md §4 for the full procedure."
    fi

    append_changes "Deploy attempt $PREV_SHA → $NEW_SHA" "FAILED at line $line — auto-reverted code" "Already reverted to $PREV_SHA. DB+uploads rollback may still be needed if MIGRATIONS_APPLIED=1 (see DISASTER-RECOVERY.md §4)."
  fi

  exit "$exit_code"
}

# --- Subcommands -----------------------------------------------------------

cmd_deploy() {
  acquire_lock
  log "=== Deploy started by $(whoami) ==="

  check_business_hours
  check_preflight
  run_backup_and_verify

  cd "$APP_DIR"
  snapshot_pre_state

  trap 'on_error $LINENO' ERR

  log "Fetching latest code"
  git fetch --prune origin
  git checkout main
  git pull --ff-only origin main
  NEW_SHA=$(git rev-parse HEAD)

  if [ "$NEW_SHA" = "$PREV_SHA" ]; then
    log "Already on $NEW_SHA — nothing to do"
    append_changes "Deploy (no-op)" "Already at $NEW_SHA" "n/a"
    exit 0
  fi

  log "Deploying $PREV_SHA → $NEW_SHA"
  log "Installing dependencies"
  npm ci

  log "Generating Prisma client"
  npx prisma generate

  if migration_files_added; then
    log "Applying Prisma migrations"
    npx prisma migrate deploy
    MIGRATIONS_APPLIED=1
  else
    log "No new migrations to apply"
    MIGRATIONS_APPLIED=0
  fi

  log "Building (heap capped at ${NODE_BUILD_HEAP_MB}M)"
  NODE_OPTIONS="--max-old-space-size=${NODE_BUILD_HEAP_MB}" npm run build

  log "Reloading PM2"
  pm2 reload "$PM2_APP_NAME"
  PM2_RELOADED=1

  log "Waiting 5s for app to come up"
  sleep 5

  if ! wait_for_health; then
    die "Health check failed after $HEALTH_RETRIES attempts — triggering rollback"
  fi

  pm2 save >> "$LOG_FILE" 2>&1 || true

  trap - ERR
  append_changes "Deploy $PREV_SHA → $NEW_SHA" "SUCCESS (migrations_applied=${MIGRATIONS_APPLIED})" "FORCE=1 deploy.sh rollback"
  log "=== Deploy complete: $NEW_SHA ==="
}

cmd_rollback() {
  acquire_lock
  log "=== Rollback started by $(whoami) ==="

  local state="$STATE_DIR/last-pre-deploy.env"
  [ -f "$state" ] || die "No rollback state at $state — nothing to roll back to"

  # shellcheck disable=SC1090
  source "$state"
  [ -n "${PREV_SHA:-}" ] || die "Bad state file: PREV_SHA missing"

  cd "$APP_DIR"
  local current_sha
  current_sha=$(git rev-parse HEAD)
  if [ "$current_sha" = "$PREV_SHA" ]; then
    log "Already on $PREV_SHA — nothing to do"
    exit 0
  fi

  log "Rolling back $current_sha → $PREV_SHA"

  # If the deploy that set this state added migrations, warn loudly.
  local migs
  migs=$(git diff --name-only "$PREV_SHA" "$current_sha" -- "prisma/migrations/" || true)
  if [ -n "$migs" ]; then
    log "WARNING: Migrations exist between $PREV_SHA and $current_sha:"
    echo "$migs" | tee -a "$LOG_FILE"
    log "This rollback reverts CODE only. The DB and uploads remain on the newer state."
    log "If the old code is incompatible, restore manually from:"
    log "  DB:      ${BACKUP_FILE_DB:-${BACKUP_FILE:-<MISSING>}}"
    if [ -n "${BACKUP_FILE_UPLOADS:-}" ]; then
      log "  Uploads: ${BACKUP_FILE_UPLOADS}"
    fi
    log "See docs/DISASTER-RECOVERY.md §4 for the full procedure."
  fi

  git reset --hard "$PREV_SHA"
  npm ci
  NODE_OPTIONS="--max-old-space-size=${NODE_BUILD_HEAP_MB}" npm run build
  pm2 reload "$PM2_APP_NAME"
  sleep 5

  if ! wait_for_health; then
    die "Health check still failing after rollback to $PREV_SHA — manual intervention required"
  fi

  append_changes "Rollback $current_sha → $PREV_SHA" "SUCCESS" "Manual: deploy.sh deploy after fixing the issue"
  log "=== Rollback complete: $PREV_SHA ==="
}

# --- Entrypoint ------------------------------------------------------------

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
touch "$LOG_FILE" 2>/dev/null || true

case "${1:-deploy}" in
  deploy)   cmd_deploy ;;
  rollback) cmd_rollback ;;
  *) echo "Usage: $0 {deploy|rollback}" >&2; exit 2 ;;
esac
