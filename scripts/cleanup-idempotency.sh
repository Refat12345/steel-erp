#!/usr/bin/env bash
# Daily idempotency-keys cleanup for Steel ERP (production)
#
# Calls POST /api/maintenance/cleanup-idempotency with the shared Bearer token
# from .env.production. The endpoint deletes expired idempotency_keys rows
# (TTL = 24h, see src/lib/idempotency.ts and DEPLOYMENT_CHECKLIST.md §2-3).
#
# Run via cron as root from /etc/cron.d/steel-erp-cleanup
#
# Manual test:
#   sudo /opt/steel-erp/app/scripts/cleanup-idempotency.sh
#
# Exit codes:
#   0 = success
#   1 = configuration error (missing secret / env file)
#   2 = network/transport error (timeout, app unreachable)
#   3 = application returned non-2xx
#
# References:
#   - DEPLOYMENT_CHECKLIST.md §2-3 (cleanup endpoint + scheduling)
#   - src/lib/idempotency.ts (24h TTL, no auto-delete)

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
ENV_FILE="${ENV_FILE:-/opt/steel-erp/app/.env.production}"
ENDPOINT="${CLEANUP_ENDPOINT:-http://127.0.0.1:3000/api/maintenance/cleanup-idempotency}"
LOG_FILE="${CLEANUP_LOG:-/var/log/steel-erp-cleanup.log}"
TIMEOUT_SEC="${CLEANUP_TIMEOUT:-30}"
MAX_ATTEMPTS="${CLEANUP_MAX_ATTEMPTS:-3}"
RETRY_DELAY="${CLEANUP_RETRY_DELAY:-5}"

# ─── Logging ──────────────────────────────────────────────────────────────────
log() {
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "[${ts}] $*" | tee -a "${LOG_FILE}"
}

fail() {
  local code=$1; shift
  log "ERROR: $*"
  log "=== Cleanup FAILED (exit ${code}) ==="
  exit "${code}"
}

# ─── Pre-flight ───────────────────────────────────────────────────────────────
touch "${LOG_FILE}"
chmod 640 "${LOG_FILE}" 2>/dev/null || true

command -v curl >/dev/null 2>&1 || fail 1 "curl not found in PATH"

if [ ! -r "${ENV_FILE}" ]; then
  fail 1 "Cannot read env file '${ENV_FILE}' (need root or readable perms)"
fi

# ─── Read secret without leaking it to ps/logs ────────────────────────────────
# Using grep+cut on the file directly. The secret never appears in argv.
SECRET="$(grep -E '^CLEANUP_SECRET=' "${ENV_FILE}" | head -n1 | cut -d= -f2- || true)"

if [ -z "${SECRET}" ]; then
  fail 1 "CLEANUP_SECRET not set in ${ENV_FILE}"
fi
if [ "${#SECRET}" -lt 32 ]; then
  fail 1 "CLEANUP_SECRET too short (${#SECRET} chars; require >= 32)"
fi

log "=== Cleanup started — endpoint: ${ENDPOINT} ==="

# ─── Call the endpoint with retries ───────────────────────────────────────────
HTTP_BODY_FILE="$(mktemp)"
trap 'rm -f "${HTTP_BODY_FILE}"' EXIT

attempt=0
HTTP_CODE=""
while [ "${attempt}" -lt "${MAX_ATTEMPTS}" ]; do
  attempt=$((attempt + 1))

  # -H 'Authorization: Bearer ...' passes secret via header (not visible in ps).
  # --max-time bounds total request lifetime.
  # --connect-timeout 5 fails fast if app is down.
  # -o writes body to file; -w prints status code; -s silent.
  HTTP_CODE="$(curl --silent --show-error \
                    --connect-timeout 5 \
                    --max-time "${TIMEOUT_SEC}" \
                    --request POST \
                    --header "Authorization: Bearer ${SECRET}" \
                    --header "User-Agent: steel-erp-cleanup-cron" \
                    --output "${HTTP_BODY_FILE}" \
                    --write-out '%{http_code}' \
                    "${ENDPOINT}" 2>>"${LOG_FILE}" || echo "000")"

  if [ "${HTTP_CODE}" = "200" ] || [ "${HTTP_CODE}" = "204" ]; then
    break
  fi

  log "Attempt ${attempt}/${MAX_ATTEMPTS} returned HTTP ${HTTP_CODE}"
  if [ "${attempt}" -lt "${MAX_ATTEMPTS}" ]; then
    sleep "${RETRY_DELAY}"
  fi
done

# Drop secret from environment promptly
unset SECRET

# ─── Interpret result ─────────────────────────────────────────────────────────
case "${HTTP_CODE}" in
  200|204)
    BODY="$(head -c 4096 "${HTTP_BODY_FILE}")"
    log "HTTP ${HTTP_CODE} — response: ${BODY}"
    log "=== Cleanup completed successfully ==="
    exit 0
    ;;
  000)
    fail 2 "Network/transport error after ${MAX_ATTEMPTS} attempts (curl exit non-zero)"
    ;;
  401|403)
    fail 3 "Authentication rejected (HTTP ${HTTP_CODE}) — CLEANUP_SECRET may be stale; rotate and update env"
    ;;
  4*|5*)
    BODY="$(head -c 4096 "${HTTP_BODY_FILE}")"
    fail 3 "Application error HTTP ${HTTP_CODE} — body: ${BODY}"
    ;;
  *)
    fail 3 "Unexpected HTTP code: ${HTTP_CODE}"
    ;;
esac
