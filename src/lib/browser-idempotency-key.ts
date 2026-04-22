/**
 * Generate a unique idempotency key for client-side `fetch()`.
 * Some bundlers polyfill `crypto` without `randomUUID`; older embedded
 * browsers may lack it too — fall back to a high-entropy string.
 */
export function createClientIdempotencyKey(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c != null && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}
