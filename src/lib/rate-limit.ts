/**
 * Simple in-memory sliding-window rate limiter.
 * Good for single-process deployments; swap to Redis for multi-instance.
 */
export interface RateLimitConfig {
  windowMs: number;
  maxAttempts: number;
}

/**
 * Per-user rate limit for scale-write endpoints (tare, gross, weigh session,
 * loading-complete). 60 req/min is well above any human operator cadence and
 * blocks runaway clients (e.g. a barcode scanner stuck in a retry loop) from
 * saturating the DB connection pool.
 */
export const SCALE_WRITE_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxAttempts: 60,
};

interface Entry {
  timestamps: number[];
}

const store = new Map<string, Entry>();

const CLEANUP_INTERVAL_MS = 60_000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup(windowMs: number) {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
      if (entry.timestamps.length === 0) store.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  ensureCleanup(config.windowMs);

  const now = Date.now();
  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => now - t < config.windowMs);

  if (entry.timestamps.length >= config.maxAttempts) {
    const oldest = entry.timestamps[0];
    const retryAfterMs = config.windowMs - (now - oldest);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: config.maxAttempts - entry.timestamps.length,
    retryAfterMs: 0,
  };
}
