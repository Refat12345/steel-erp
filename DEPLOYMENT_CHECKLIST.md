# Steel ERP — Production Deployment Checklist

Operational checklist for a **single-instance production deployment** of the Truck & Scale module and the surrounding app.

> For the full VPS + Nginx + PostgreSQL setup (Arabic walkthrough), see [`DEPLOYMENT.md`](./DEPLOYMENT.md). This file focuses on the artefacts introduced by the concurrency / idempotency hardening work and lists exactly what must be true before flipping the production switch.

---

## 1. Environment variables

Set these on your production host before first boot. On Vercel: **Project → Settings → Environment Variables**. On a VM: put them in the systemd unit file, the PM2 ecosystem file, or `/etc/environment` — **never** commit them.

| Variable | Required | How to generate | Purpose |
|---|---|---|---|
| `DATABASE_URL` | **yes** | Supabase → Connect → ORM → Prisma (copy the pooler URL) | Prisma runtime connection. For Supabase use the pooler URL with `?pgbouncer=true&connection_limit=1`. For self-hosted Postgres use a direct URL. |
| `DIRECT_URL` | **yes** | Supabase → Connect → ORM → Prisma (copy the direct URL) | Used by Prisma for migrations. If you are on self-hosted Postgres (single URL), set this to the same value as `DATABASE_URL`. |
| `NEXTAUTH_SECRET` | **yes** | `openssl rand -hex 32` | JWT signing key for sessions. Rotating this logs everyone out. |
| `NEXTAUTH_URL` | **yes** | Your public HTTPS URL, no trailing slash. Example: `https://erp.example.com` | Must match the URL users hit the app on, or NextAuth redirects break. |
| `CLEANUP_SECRET` | recommended | `openssl rand -hex 32` | Shared secret accepted by `/api/maintenance/cleanup-idempotency` as a `Bearer` token. Leave unset and the endpoint falls back to requiring an admin session (which breaks headless cron). |
| `LOG_LEVEL` | optional | `info` (default) / `warn` / `error` / `debug` | Pino log verbosity. |

Copy `.env.example` as a starting template.

### Sanity-check the values

```bash
# On the server, with the env loaded:
node -e "console.log('DB ok:', !!process.env.DATABASE_URL)"
node -e "console.log('Auth ok:', (process.env.NEXTAUTH_SECRET || '').length >= 32)"
node -e "console.log('Cron ok:', (process.env.CLEANUP_SECRET || '').length >= 32)"
```

All three should print `: true`.

---

## 2. The maintenance cleanup endpoint

### What it does

`GET|POST /api/maintenance/cleanup-idempotency` deletes every row in `idempotency_keys` whose `expires_at` is in the past. The idempotency key table grows by roughly one row per successful write request from the Truck & Scale module (and any other endpoint wrapped by `withIdempotency`). Rows auto-expire after 24 hours but **are not deleted automatically** — this endpoint is the garbage collector.

### How to call it

The endpoint accepts either of two authentication mechanisms:

**Option A — Bearer token (for schedulers, headless).** Set `CLEANUP_SECRET` and send:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $CLEANUP_SECRET" \
  https://erp.example.com/api/maintenance/cleanup-idempotency
```

Successful response:

```json
{ "success": true, "deleted": 1427 }
```

**Option B — Admin session (for manual triggers).** Log in as an `admin` user in the browser, then hit the URL directly or POST from DevTools. Used for ad-hoc "clean this up now" runs.

If neither mechanism succeeds, the endpoint returns HTTP 401.

### Expected behaviour

- First-time call on a fresh DB returns `deleted: 0`.
- Under normal traffic the endpoint finishes in well under a second (one indexed `DELETE` on `expires_at`).
- Safe to call as often as you like. Daily is plenty.

---

## 3. Scheduling the cleanup job

Pick **one** of the options below based on your deployment topology.

### 3.a — Vercel Cron (if deployed on Vercel)

Add a `vercel.json` at the repo root (or merge into your existing one):

```json
{
  "crons": [
    {
      "path": "/api/maintenance/cleanup-idempotency",
      "schedule": "0 3 * * *"
    }
  ]
}
```

Vercel Cron sends a `GET` with its own bearer header derived from the `CRON_SECRET` project env var. To use **our** `CLEANUP_SECRET` instead:

- Either set `CRON_SECRET` to the same value as `CLEANUP_SECRET` (simplest), or
- Use an external scheduler and leave Vercel Cron off.

Deploy and verify in **Project → Deployments → Crons** that the next run is scheduled.

### 3.b — Linux cron (VPS / self-hosted)

Edit the crontab of a non-root user:

```bash
crontab -e
```

Append:

```
# Steel ERP — delete expired idempotency keys, daily at 03:00
0 3 * * * curl -fsS -X POST -H "Authorization: Bearer YOUR_CLEANUP_SECRET_HERE" https://erp.example.com/api/maintenance/cleanup-idempotency >> /var/log/erp-cleanup.log 2>&1
```

Do **not** hard-code the secret in the crontab. Better:

```bash
# /etc/erp/env
CLEANUP_SECRET=xxxxx...
```

Then in the crontab:

```
0 3 * * * . /etc/erp/env && curl -fsS -X POST -H "Authorization: Bearer $CLEANUP_SECRET" https://erp.example.com/api/maintenance/cleanup-idempotency >> /var/log/erp-cleanup.log 2>&1
```

Verify tomorrow morning: `tail /var/log/erp-cleanup.log` should show a single line with `{"success":true,"deleted":N}`.

### 3.c — systemd timer (alternative to cron, cleaner logs)

`/etc/systemd/system/erp-cleanup.service`:

```ini
[Unit]
Description=Steel ERP - delete expired idempotency keys
After=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/erp/env
ExecStart=/usr/bin/curl -fsS -X POST \
  -H "Authorization: Bearer ${CLEANUP_SECRET}" \
  https://erp.example.com/api/maintenance/cleanup-idempotency
```

`/etc/systemd/system/erp-cleanup.timer`:

```ini
[Unit]
Description=Run Steel ERP idempotency cleanup daily

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now erp-cleanup.timer
sudo systemctl list-timers erp-cleanup.timer
```

Logs via `journalctl -u erp-cleanup.service`.

### 3.d — Postgres `pg_cron` (app-bypassing, fastest)

If you run self-hosted Postgres with the `pg_cron` extension, skip the app entirely:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'erp-idempotency-cleanup',
  '0 3 * * *',
  $$ DELETE FROM idempotency_keys WHERE expires_at < now() $$
);
```

Trade-off: no app-level log line, but zero network round-trip.

---

## 4. Pre-launch checklist

Run through these in order. Each item is either `[x]` done or a blocker.

### 4.a — Database

- [ ] PostgreSQL 14+ provisioned and reachable from the app host.
- [ ] `DATABASE_URL` and `DIRECT_URL` set in production env.
- [ ] Migrations applied: `npx prisma migrate deploy` (NOT `migrate dev` in production).
- [ ] Seeded at least one active `admin` user: needed for the first login and for admin-session-based endpoint access.
- [ ] Seeded at least one active `customer`: the truck register flow requires one.
- [ ] Confirm the `idempotency_keys` and `truck_operations.version` / `weigh_sessions.version` columns exist:

  ```sql
  \d idempotency_keys
  \d truck_operations
  \d weigh_sessions
  ```

### 4.b — Application env

- [ ] `NEXTAUTH_SECRET` set (32+ hex chars).
- [ ] `NEXTAUTH_URL` matches the public HTTPS URL exactly (no trailing slash).
- [ ] `CLEANUP_SECRET` set and matches what the scheduler sends.
- [ ] `LOG_LEVEL` is `info` or `warn` in production (not `debug` — noisy).
- [ ] Build passes: `npm run build`.
- [ ] Type-check clean: `npx tsc --noEmit`.
- [ ] Test suite green: `npx vitest run` → **14 files / 139 tests passed**.

### 4.c — Maintenance

- [ ] Cleanup job scheduled via one of the options in section 3.
- [ ] First manual run of the cleanup endpoint succeeds and returns `deleted: 0` (fresh DB) or a positive number.
- [ ] Log destination for cleanup runs is writable and reachable.

### 4.d — Backups

- [ ] Nightly `pg_dump` (or managed-DB PITR) configured and verified once by doing a restore drill.
- [ ] Backups stored **off-host** (Backblaze B2, S3, Wasabi, etc.). See [`DEPLOYMENT.md` § 9](./DEPLOYMENT.md).
- [ ] Retention policy set (recommended: 7 daily + 4 weekly + 6 monthly).

### 4.e — Observability

- [ ] Uptime monitor pointed at `/api/health` or the login page (UptimeRobot free plan is fine).
- [ ] App logs are going somewhere durable (PM2 log rotation, journald, or a managed log service).
- [ ] Error alerting wired to at least one human — even a simple "5xx spike" email is enough for day one.

### 4.f — Security

- [ ] HTTPS enforced at the reverse proxy or platform layer.
- [ ] `NEXTAUTH_SECRET` and `CLEANUP_SECRET` are **not** in the git repo, `.env.example`, or any Docker image layer.
- [ ] Database user has only the privileges it needs (no superuser in prod).
- [ ] Admin user passwords are not the seed defaults.
- [ ] Network rules: DB port is not exposed to the internet.

### 4.g — Sanity checks right before go-live

- [ ] Log in as admin → register a test truck → tare → 2 sessions → photo → loading complete → gross → close. The full state machine must transition without error.
- [ ] Cancel a test truck from the OnScale state. Verify no orphan weigh sessions remain.
- [ ] Hit an idempotent write twice with the same `Idempotency-Key`: second response body is byte-identical.
- [ ] Delete the test truck and any test data created during this pass.

---

## 5. Deferred items (non-blocking for single-instance launch)

These are required **only** if and when you horizontally scale beyond a single Node.js instance. They were deliberately left out because the one-instance topology makes them unnecessary and adds operational weight.

### 5.a — Distributed rate limiter

The in-memory rate limiter in `src/lib/rate-limit.ts` uses a per-process `Map`. Two replicas will each grant their own quota, effectively doubling the configured limit per user.

**Mitigation when you scale out:** replace the `Map` with Redis `INCR` + `EXPIRE` or with a Postgres table backed by the `SKIP LOCKED` pattern. Both have well-known Node.js libraries (`rate-limiter-flexible`, `@upstash/ratelimit`).

### 5.b — Cross-instance idempotency leader coordination

The `inflightLeaders` `Map` inside `src/lib/idempotency.ts` serialises concurrent same-key requests **within one Node process**. Across replicas, the fallback is the DB-level unique constraint on `(user_id, key)` — still correct, but one replica's client sees its own `compute()` result while others see the replayed version.

**Mitigation when you scale out:** swap the in-memory map for either:
- **Postgres advisory lock:** `pg_try_advisory_xact_lock(hashtext(userId || ':' || key))` at the start of the handler; release on commit.
- **Redis `SETNX`:** `SET idempotency:<userId>:<key> 1 NX EX 60` as the reservation primitive.

Both ~50 lines of code.

### 5.c — Photo upload idempotency

`POST /api/trucks/[id]/photo` is intentionally **not** wrapped by `withIdempotency` because its body is `multipart/form-data`, not JSON. A flaky upload retried by the user will create a duplicate `TruckPhoto` row.

**Mitigation options:**
- Hash the file bytes on upload and reject on collision (easy, correct).
- Generate a client-side file ID in the picker, store it in `TruckPhoto.clientId`, add a partial unique index on `(truckOperationId, clientId)`.
- Accept the duplicate rows and dedupe visually — photos are cheap.

### 5.d — End-to-end HTTP smoke test

The unit + concurrency verification does not exercise:
- NextAuth cookie / session roundtrip.
- The rate-limit middleware.
- The RBAC permission checks.

A short Playwright or supertest flow covering the full truck lifecycle (register → close) with an authenticated client would plug this gap.

---

## 6. Rollback plan

If something goes wrong on day one:

1. **App broken, DB fine:** redeploy the previous image/commit. No data migration to reverse.
2. **Migration broken:** use Prisma's migration history. All migrations in this module are additive (no drops) and safe to leave partially applied. Do **not** rerun `migrate dev` in production.
3. **Concurrency regression:** the feature flag is the absence of the `Idempotency-Key` header — if clients stop sending it, all write endpoints still work correctly, they just lose replay protection.
4. **Cleanup endpoint compromised:** rotate `CLEANUP_SECRET`, redeploy, update the scheduler.

Full backup restore procedure is in [`DEPLOYMENT.md` § 9](./DEPLOYMENT.md).

---

## 7. Day-two operations

Routine tasks with rough cadence.

| Cadence | Task |
|---|---|
| Continuous | Uptime monitor, error alerting. |
| Daily | Automatic idempotency key cleanup (via scheduler in § 3). |
| Daily | Automatic DB backup. |
| Weekly | Review audit log for anomalies, check backup off-site sync. |
| Monthly | Rotate reverse-proxy TLS cert (Let's Encrypt auto-renews; verify). |
| Quarterly | Rotate `CLEANUP_SECRET`. Perform a restore drill from the off-site backup. |
| Yearly | Rotate `NEXTAUTH_SECRET` (note: this logs everyone out). |

---

**Sign-off**

When every box in § 4 is checked, the Truck & Scale module is cleared for single-instance production traffic. Green light.
