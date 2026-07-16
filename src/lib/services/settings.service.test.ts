/**
 * Analytics-start clamp tests.
 *
 * `clampEventWindow` is the single security floor for every event list
 * and report — these tests pin its contract: floor unbounded queries,
 * raise explicit `from` values, never touch `to`, and degrade safely
 * when the setting is unset or malformed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  systemSetting: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
  revalidateTag: vi.fn(),
}));

import { clampEventWindow, getAnalyticsStartInstant } from "./settings.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAnalyticsStartInstant", () => {
  it("returns the 08:00 operational cutoff of the configured date", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: "2026-06-01" });

    expect(await getAnalyticsStartInstant()).toEqual(
      new Date(2026, 5, 1, 8, 0, 0, 0),
    );
  });

  it("returns null when the setting is unset", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue(null);

    expect(await getAnalyticsStartInstant()).toBeNull();
  });

  it("returns null for a malformed stored value instead of throwing", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: "13/07/2026" });

    expect(await getAnalyticsStartInstant()).toBeNull();
  });
});

describe("clampEventWindow", () => {
  it("passes through unchanged when no start date is configured", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
    const from = new Date(2026, 0, 1);
    const to = new Date(2026, 0, 31);

    const result = await clampEventWindow(from, to);

    expect(result).toEqual({
      from,
      to,
      clamped: false,
      analyticsStartDate: null,
    });
  });

  it("floors an unbounded query at the start's 08:00 cutoff without flagging", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: "2026-06-01" });

    const result = await clampEventWindow(undefined, undefined);

    expect(result.from).toEqual(new Date(2026, 5, 1, 8, 0, 0, 0));
    expect(result.to).toBeUndefined();
    expect(result.clamped).toBe(false);
    expect(result.analyticsStartDate).toBe("2026-06-01");
  });

  it("raises an explicit from that reaches before the start and flags it", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: "2026-06-01" });
    const to = new Date(2026, 6, 1, 8, 0, 0, 0);

    const result = await clampEventWindow(new Date(2026, 0, 1, 8, 0, 0, 0), to);

    expect(result.from).toEqual(new Date(2026, 5, 1, 8, 0, 0, 0));
    expect(result.to).toEqual(to);
    expect(result.clamped).toBe(true);
    expect(result.analyticsStartDate).toBe("2026-06-01");
  });

  it("leaves a from at or after the start untouched", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: "2026-06-01" });
    const from = new Date(2026, 5, 15, 8, 0, 0, 0);

    const result = await clampEventWindow(from, undefined);

    expect(result.from).toEqual(from);
    expect(result.clamped).toBe(false);
  });

  it("does not flag a from exactly at the start boundary", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: "2026-06-01" });
    const from = new Date(2026, 5, 1, 8, 0, 0, 0);

    const result = await clampEventWindow(from, undefined);

    expect(result.from).toEqual(from);
    expect(result.clamped).toBe(false);
    expect(result.analyticsStartDate).toBe("2026-06-01");
  });

  it("raises from by one millisecond less than the boundary and flags it", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: "2026-06-01" });
    const from = new Date(2026, 5, 1, 7, 59, 59, 999);

    const result = await clampEventWindow(from, undefined);

    expect(result.from).toEqual(new Date(2026, 5, 1, 8, 0, 0, 0));
    expect(result.clamped).toBe(true);
  });

  it("never touches the upper bound, even when it precedes the start", async () => {
    // A fully pre-start window: `to` passes through — collapsing the range
    // to empty is each report's responsibility (clampReportWindow).
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: "2026-06-01" });
    const from = new Date(2026, 4, 1, 8, 0, 0, 0);
    const to = new Date(2026, 4, 10, 8, 0, 0, 0);

    const result = await clampEventWindow(from, to);

    expect(result.from).toEqual(new Date(2026, 5, 1, 8, 0, 0, 0));
    expect(result.to).toEqual(to);
    expect(result.clamped).toBe(true);
  });

  it("degrades to no filter when the stored value is malformed", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: "garbage" });
    const from = new Date(2026, 0, 1);

    const result = await clampEventWindow(from, undefined);

    expect(result).toEqual({
      from,
      to: undefined,
      clamped: false,
      analyticsStartDate: null,
    });
  });
});
