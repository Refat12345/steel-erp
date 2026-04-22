import { describe, it, expect } from "vitest";
import {
  checkRateLimit,
  LOGIN_RATE_LIMIT,
  SCALE_WRITE_RATE_LIMIT,
} from "./rate-limit";

describe("LOGIN_RATE_LIMIT — Part 6 brute-force protection", () => {
  it("blocks after 10 attempts within 60 s", () => {
    // Use a unique key per test run to isolate from other tests sharing the
    // in-memory store. The sliding window means state persists across
    // invocations of checkRateLimit for the same key.
    const key = `login:test:${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      const r = checkRateLimit(key, LOGIN_RATE_LIMIT);
      expect(r.allowed).toBe(true);
    }
    const blocked = checkRateLimit(key, LOGIN_RATE_LIMIT);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("has the exact Part 6 parameters (10 attempts / 60 s)", () => {
    expect(LOGIN_RATE_LIMIT.maxAttempts).toBe(10);
    expect(LOGIN_RATE_LIMIT.windowMs).toBe(60_000);
  });

  it("does not interfere with scale write buckets", () => {
    // Separate keys => separate counters. Regression test against a refactor
    // that accidentally shares the Map across configs.
    const k = `scale:test:${Math.random()}`;
    for (let i = 0; i < 50; i++) {
      expect(checkRateLimit(k, SCALE_WRITE_RATE_LIMIT).allowed).toBe(true);
    }
  });
});
