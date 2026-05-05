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
BACKUP_SCRIPT="/opt/steel-erp/scripts/backup.sh"
LOCAL_BACKUP_DIR="/tmp/steel-erp-backups"
B2_REMOTE="b2:steel-erp-backups"
LOCK_FILE="/tmp/steel-erp-deploy.lock"
LOG_FILE="/var/log/steel-erp-deploy.log"
CHANGES_FILE="/opt/steel-erp/CHANGES.md"
PM2_APP_NAME="steel-erp"
HEALTH_URL="http://localhost:3000/api/health"

MIN_DISK_FREE_MB=2048           # require ≥ 2 GB free on /
MIN_RAM_FREE_MB=300             # require ≥ 300 MB available RAM
MIN_BACKUP_BYTES=$((1024 * 1024)) # 1 MB sanity floor for the backup file
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
  if ! pm2 jlist | grep -q "\"name\":\"${PM2_APP_NAME}\""; then
    die "PM2 has no app named '$PM2_APP_NAME' — start it manually first"
  fi
  local pm2_status
  pm2_status=$(pm2 jlist | sed -n "s/.*\"name\":\"${PM2_APP_NAME}\"[^}]*\"status\":\"\([^\"]*\)\".*/\1/p" | head -1)
  [ "$pm2_status" = "online" ] || die "PM2 reports '$PM2_APP_NAME' as '$pm2_status' (expected 'online'). Investigate before deploying."

  log "Pre-flight OK (disk=${disk_free_mb}M, ram=${ram_free_mb}M, branch=$current_branch)"
}

run_backup_and_verify() {
  log "Running backup before deploy"
  "$BACKUP_SCRIPT" >> "$LOG_FILE" 2>&1 \
    || die "Backup script failed — see $LOG_FILE"

  # Pick the most recently created backup file.
  BACKUP_FILE=$(ls -1t "$LOCAL_BACKUP_DIR"/db_*.dump.gz 2>/dev/null | head -1 || true)
  [ -n "$BACKUP_FILE" ] || die "No backup file found in $LOCAL_BACKUP_DIR"
  [ -s "$BACKUP_FILE" ] || die "Backup file is empty: $BACKUP_FILE"

  local size
  size=$(stat -c '%s' "$BACKUP_FILE")
  [ "$size" -ge "$MIN_BACKUP_BYTES" ] \
    || die "Backup unrealistically small: ${size} bytes (floor: ${MIN_BACKUP_BYTES})"

  gunzip -t "$BACKUP_FILE" \
    || die "Backup gzip integrity check failed: $BACKUP_FILE"

  local b2_key
  b2_key=$(basename "$BACKUP_FILE")
  rclone lsf "${B2_REMOTE}/daily/" 2>/dev/null | grep -Fxq "$b2_key" \
    || die "Backup not found off-site at ${B2_REMOTE}/daily/${b2_key}"

  B2_KEY="$b2_key"
  log "Backup verified: $BACKUP_FILE (${size} bytes, off-site OK)"
}

snapshot_pre_state() {
  mkdir -p "$STATE_DIR"
  cd "$APP_DIR"
  PREV_SHA=$(git rev-parse HEAD)
  pm2 jlist > "$STATE_DIR/pm2-pre-${PREV_SHA}.json" 2>/dev/null || true

  # Shell-sourceable state file. Keep it flat and key=value for portability
  # (no jq dependency). Do NOT put secrets here.
  cat > "$STATE_DIR/last-pre-deploy.env" <<EOF
PREV_SHA="$PREV_SHA"
BACKUP_FILE="$BACKUP_FILE"
B2_KEY="$B2_KEY"
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
      log "  2. pg_restore -U steel_erp -d steel_erp_prod -h localhost --clean --no-owner --no-acl <(gunzip -c $BACKUP_FILE)"
      log "  3. pm2 start $PM2_APP_NAME"
    fi

    append_changes "Deploy attempt $PREV_SHA → $NEW_SHA" "FAILED at line $line — auto-reverted code" "Already reverted to $PREV_SHA. DB rollback may still be needed if MIGRATIONS_APPLIED=1."
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
    log "This rollback reverts CODE only. The DB will remain on the newer schema."
    log "If the old code is incompatible, restore the DB manually from $BACKUP_FILE."
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
