import { describe, it, expect } from "vitest";
import { checkRateLimit } from "./rate-limit";

const config = { windowMs: 60_000, maxAttempts: 3 };

describe("checkRateLimit", () => {
  it("allows requests within the limit", () => {
    const key = `test-allow-${Date.now()}-${Math.random()}`;
    const r = checkRateLimit(key, config);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
    expect(r.retryAfterMs).toBe(0);
  });

  it("decrements remaining on each call", () => {
    const key = `test-dec-${Date.now()}-${Math.random()}`;
    expect(checkRateLimit(key, config).remaining).toBe(2);
    expect(checkRateLimit(key, config).remaining).toBe(1);
    expect(checkRateLimit(key, config).remaining).toBe(0);
  });

  it("blocks after maxAttempts reached", () => {
    const key = `test-block-${Date.now()}-${Math.random()}`;
    checkRateLimit(key, config);
    checkRateLimit(key, config);
    checkRateLimit(key, config);
    const r = checkRateLimit(key, config);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it("uses separate counters per key", () => {
    const key1 = `test-sep1-${Date.now()}-${Math.random()}`;
    const key2 = `test-sep2-${Date.now()}-${Math.random()}`;
    checkRateLimit(key1, config);
    checkRateLimit(key1, config);
    expect(checkRateLimit(key1, config).remaining).toBe(0);
    expect(checkRateLimit(key2, config).remaining).toBe(2);
  });
});
