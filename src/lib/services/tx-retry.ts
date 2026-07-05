import { Prisma } from "@prisma/client";

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 20;

/**
 * Unique constraints whose values are GENERATED inside the transaction
 * (max-seq + 1 pattern). A P2002 collision on these means two concurrent
 * transactions computed the same next number — re-running the transaction
 * recomputes a fresh number, so retrying is safe and correct:
 *
 * - `session_number`  — weigh_sessions (truck/scale module)
 * - `receipt_number`  — billet_receipts (R-YY-NNNN and PW-YY-NNNN)
 * - `contract_number` — supplier_contracts (P-YY-NNN)
 *
 * Both snake_case (DB column) and camelCase (Prisma field) spellings are
 * listed because Prisma's P2002 `meta.target` shape varies by constraint
 * kind. Matching is by EXACT field token, not substring — a substring match
 * on `contract_number` would wrongly catch `supplier_contract_number`
 * uniques (real domain errors on piece lines).
 *
 * User-supplied uniques (e.g. `plate_number`) must NOT be listed here:
 * a collision on those is a real domain error and retrying would just
 * fail again with the same input.
 */
const RETRYABLE_GENERATED_UNIQUE_FIELDS = new Set([
  "session_number",
  "sessionNumber",
  "receipt_number",
  "receiptNumber",
  "contract_number",
  "contractNumber",
]);

/** Fallback for when Prisma reports the DB constraint name as a plain string. */
const RETRYABLE_GENERATED_UNIQUE_CONSTRAINTS = new Set([
  "weigh_sessions_truck_operation_id_session_number_key",
  "billet_receipts_receipt_number_key",
  "supplier_contracts_pkey",
]);

function isGeneratedUniqueTarget(target: unknown): boolean {
  if (Array.isArray(target)) {
    return target.some((t) => RETRYABLE_GENERATED_UNIQUE_FIELDS.has(String(t)));
  }
  const s = String(target ?? "");
  return RETRYABLE_GENERATED_UNIQUE_FIELDS.has(s) || RETRYABLE_GENERATED_UNIQUE_CONSTRAINTS.has(s);
}

/**
 * Decide if a thrown error should trigger a retry of the enclosing transaction.
 *
 * - P2034: Serializable isolation anomaly (transaction aborted). Always retryable.
 * - P2002: Unique constraint violation. Retryable ONLY for generated sequence
 *   numbers (see `RETRYABLE_GENERATED_UNIQUE_FIELDS`). All other unique
 *   violations (e.g. duplicate plate number) are real domain errors and must
 *   NOT be retried.
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
      return isGeneratedUniqueTarget(e.meta?.target);
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
