import { Prisma } from "@prisma/client";

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 20;

/**
 * Decide if a thrown error should trigger a retry of the enclosing transaction.
 *
 * - P2034: Serializable isolation anomaly (transaction aborted). Always retryable.
 * - P2002: Unique constraint violation. Retryable ONLY for the `session_number`
 *   constraint on `weigh_sessions`, which can fire when two concurrent inserts
 *   compute the same next sequence number. All other unique violations (e.g.
 *   duplicate plate number) are real domain errors and must NOT be retried.
 * - PG 40001 / 40P01 leaking from `$queryRaw` or `$executeRaw` inside a
 *   Serializable transaction. These arrive as an Unknown/Known request error
 *   whose message carries ``Code: `40001` `` (serialization failure) or
 *   ``Code: `40P01` `` (deadlock). Prisma does NOT map these to P2034 the way
 *   it does for ordinary CRUD — so we must sniff the message text as well.
 */
function isRetryable(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2034") return true;
    if (e.code === "P2002") {
      const target = e.meta?.target;
      const targetStr = Array.isArray(target) ? target.join(",") : String(target ?? "");
      return targetStr.includes("session_number");
    }
  }
  // Raw-query path: Prisma surfaces PG's 40001 / 40P01 as a message-only error
  // that bypasses the P2034 mapping. Fall back to text matching.
  if (e instanceof Error) {
    const m = e.message ?? "";
    if (m.includes("Code: `40001`") || m.includes("Code: `40P01`")) return true;
  }
  return false;
}

/**
 * Retry a transaction that may fail with a transient concurrency error.
 * Used around `prisma.$transaction` with `isolationLevel: "Serializable"`.
 *
 * Backoff is exponential (20ms, 40ms, 80ms, 160ms) to reduce thundering herd
 * when many operators hit the same row simultaneously.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRetryable(e) || attempt === MAX_RETRIES - 1) throw e;
      const delay = BASE_BACKOFF_MS * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}
