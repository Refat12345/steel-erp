import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import { translateError } from "@/lib/i18n/server-messages";

/**
 * How long a stored response stays available for replay. Stripe uses 24h and
 * that matches the operational window in which an operator is likely to retry
 * a truck write (shift length, network outage, phone reboot).
 */
const TTL_HOURS = 24;

/**
 * Arbitrary upper bound to stop abusive clients from filling the table with
 * huge keys. UUIDs are 36 chars; 200 is plenty of headroom.
 */
const MAX_KEY_LENGTH = 200;

export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/**
 * Per-process mutex map keyed by `${userId}:${key}`. Serializes concurrent
 * same-key requests hitting this Node process so that exactly one of them
 * executes the handler while the others wait for the leader to finish, then
 * replay its stored response.
 *
 * For horizontally-scaled deployments (multiple Node instances behind a load
 * balancer) this only protects within a single instance. Cross-instance
 * concurrency is still handled by the DB-level unique constraint on
 * (user_id, key): a P2002 collision during storage indicates another process
 * got there first, and future retries will replay from the DB.
 *
 * Why in-memory rather than a DB advisory lock: the dominant retry pattern is
 * a user clicking twice on their phone or a flaky connection triggering a
 * second attempt moments after the first — both go to the same app instance
 * in 99% of topologies. An in-process mutex handles this case with zero
 * additional DB round-trips.
 */
const inflightLeaders = new Map<string, Promise<void>>();

/**
 * Wrap a write-endpoint handler with idempotency-key replay protection.
 *
 * Clients that send `Idempotency-Key` get:
 * - The same response body (with the same status) on retries with the same
 *   key and same body, for {@link TTL_HOURS} hours.
 * - A 409 if they reuse the key with a different body — this prevents a
 *   misbehaving client from accidentally recording two different payloads
 *   under one key.
 * - Normal behavior if they don't send the header; this helper is a no-op.
 *
 * Only 2xx responses are persisted. Validation/domain errors (4xx) and
 * server errors (5xx) are deliberately NOT cached, so the client can fix the
 * payload and retry with the same key without being stuck on a stale error.
 *
 * Concurrent same-key requests in this process are serialized via the
 * {@link inflightLeaders} mutex so only one executes the handler; the rest
 * wait and replay from the stored response.
 */
export async function withIdempotency(
  req: NextRequest,
  userId: number,
  bodyText: string,
  compute: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const raw = req.headers.get(IDEMPOTENCY_HEADER);
  if (!raw || !raw.trim()) {
    return compute();
  }
  const key = raw.trim();
  if (key.length > MAX_KEY_LENGTH) {
    return NextResponse.json(
      { success: false, error: "Idempotency-Key طويل جداً" },
      { status: 400 },
    );
  }

  const method = req.method;
  const path = new URL(req.url).pathname;
  const requestHash = crypto
    .createHash("sha256")
    .update(`${method}\n${path}\n${bodyText}`)
    .digest("hex");
  const lockKey = `${userId}:${key}`;

  // Phase 1: fast-path DB lookup for an already-persisted response.
  const cached = await tryReplay(userId, key, requestHash);
  if (cached) return cached;

  // Phase 2: if another request in this process is currently computing for
  // the same key, wait for it and replay whatever it stored.
  const existingLeader = inflightLeaders.get(lockKey);
  if (existingLeader) {
    await existingLeader.catch(() => {});
    const replay = await tryReplay(userId, key, requestHash);
    if (replay) return replay;
    // Leader didn't persist a replayable response (e.g. it hit a 4xx that
    // we intentionally don't cache). Fall through and execute independently;
    // validation/domain failures are retry-safe with the same key because
    // only 2xx gets persisted.
  }

  // Phase 3: claim leader slot. The Map.get + Map.set pair below is
  // synchronous so no other request can interleave between the check and
  // the set within this event-loop tick.
  let resolveLeader: () => void = () => {};
  const leaderPromise = new Promise<void>((resolve) => {
    resolveLeader = resolve;
  });
  inflightLeaders.set(lockKey, leaderPromise);

  try {
    const response = await compute();

    if (response.status >= 200 && response.status < 300) {
      try {
        const cloned = response.clone();
        const body = (await cloned.json()) as Prisma.InputJsonValue;
        await prisma.idempotencyKey.create({
          data: {
            userId,
            key,
            method,
            path,
            requestHash,
            responseStatus: response.status,
            responseBody: body,
            expiresAt: new Date(Date.now() + TTL_HOURS * 3_600_000),
          },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          // Cross-process race: another Node instance stored a response for
          // this key first. That's fine — future retries will see their row.
          logger.debug({ userId, key }, "idempotency key race (P2002) — ignoring");
        } else {
          logger.warn({ err: e, userId, key }, "failed to persist idempotency key");
        }
      }
    }

    return response;
  } finally {
    resolveLeader();
    inflightLeaders.delete(lockKey);
  }
}

/**
 * Look up the persisted response for a key. Returns `null` on cache miss or
 * expiry. On expiry, deletes the stale row so the caller can re-claim the
 * key. Returns a 409 response if the stored hash does not match.
 */
async function tryReplay(
  userId: number,
  key: string,
  requestHash: string,
): Promise<NextResponse | null> {
  const existing = await prisma.idempotencyKey.findUnique({
    where: { userId_key: { userId, key } },
  });
  if (!existing) return null;

  if (existing.expiresAt <= new Date()) {
    await prisma.idempotencyKey
      .delete({ where: { userId_key: { userId, key } } })
      .catch(() => {
        // A concurrent request may have already cleaned it up.
      });
    return null;
  }

  if (existing.requestHash !== requestHash) {
    const locale = await getRequestLocale();
    return NextResponse.json(
      {
        success: false,
        error: translateError(locale, "idempotencyKeyMismatch"),
      },
      { status: 409 },
    );
  }

  return NextResponse.json(existing.responseBody, {
    status: existing.responseStatus,
  });
}

/**
 * Read the request body as text once (for idempotency hashing) and return
 * both the raw text and the parsed JSON. Returns `ok: false` if the body is
 * non-empty but not valid JSON.
 *
 * Empty bodies parse to `{}` so callers can uniformly pass the result into a
 * Zod validator.
 */
export async function readJsonBody(
  req: NextRequest,
): Promise<{ ok: true; text: string; json: unknown } | { ok: false }> {
  const text = await req.text();
  if (!text) return { ok: true, text: "", json: {} };
  try {
    return { ok: true, text, json: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Delete all idempotency keys whose `expires_at` is in the past.
 *
 * The `idempotency_keys` table grows at the rate of non-replayed writes. Each
 * row is small (~few hundred bytes) but over months of traffic the table will
 * carry millions of dead rows and the `(expires_at)` index will bloat. This
 * function is meant to be called on a schedule — see the `/api/maintenance/
 * cleanup-idempotency` endpoint which exposes it to an external scheduler.
 *
 * Returns the number of rows deleted (useful for logging / metrics).
 */
export async function cleanupExpiredIdempotencyKeys(): Promise<number> {
  const started = Date.now();
  const result = await prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  const elapsedMs = Date.now() - started;
  logger.info(
    { deleted: result.count, elapsedMs },
    "idempotency keys cleanup completed",
  );
  return result.count;
}
