/**
 * Legacy sales-dashboard stats — analytics-start clamping.
 *
 * `/api/dashboard/stats` aggregates payment EVENTS (timeline, totals,
 * top customers, method split). Without the floor these leak the whole
 * pre-start era. `paymentDate` is date-only (UTC midnight), so the floor
 * is the calendar date — not the 08:00 operational instant.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  salesOrder: { groupBy: vi.fn(), count: vi.fn() },
  masterContract: { groupBy: vi.fn(), count: vi.fn() },
  customer: { count: vi.fn(), findMany: vi.fn() },
  payment: { findMany: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
  revalidateTag: vi.fn(),
}));

const mockGetAnalyticsStartDateValue = vi.hoisted(() =>
  vi.fn(async (): Promise<string | null> => null),
);
vi.mock("@/lib/services/settings.service", () => ({
  getAnalyticsStartDateValue: mockGetAnalyticsStartDateValue,
  DASHBOARD_STATS_CACHE_TAG: "dashboard-stats",
}));

import { getDashboardStatsCached } from "./dashboard-stats";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-20T10:00:00.000Z"));
  mockPrisma.salesOrder.groupBy.mockResolvedValue([]);
  mockPrisma.salesOrder.count.mockResolvedValue(0);
  mockPrisma.masterContract.groupBy.mockResolvedValue([]);
  mockPrisma.masterContract.count.mockResolvedValue(0);
  mockPrisma.customer.count.mockResolvedValue(0);
  mockPrisma.customer.findMany.mockResolvedValue([]);
  mockPrisma.payment.findMany.mockResolvedValue([]);
  mockPrisma.payment.groupBy.mockResolvedValue([]);
  mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
  mockGetAnalyticsStartDateValue.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getDashboardStatsCached analytics-start clamping", () => {
  it("aggregates all payments when no start date is configured", async () => {
    await getDashboardStatsCached();

    // Top customers + method split: unbounded.
    expect(mockPrisma.payment.groupBy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ by: ["customerId"], where: {} }),
    );
    expect(mockPrisma.payment.groupBy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ by: ["method"], where: {} }),
    );
    expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith({
      where: {},
      _sum: { amount: true },
    });
    // Timeline: plain 30-day lookback.
    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paymentDate: { gte: new Date("2026-05-21T10:00:00.000Z") } },
      }),
    );
  });

  it("floors every payment aggregate at the start DATE (UTC midnight)", async () => {
    mockGetAnalyticsStartDateValue.mockResolvedValue("2026-06-05");
    const dateFloor = new Date("2026-06-05T00:00:00.000Z");

    await getDashboardStatsCached();

    expect(mockPrisma.payment.groupBy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        by: ["customerId"],
        where: { paymentDate: { gte: dateFloor } },
      }),
    );
    expect(mockPrisma.payment.groupBy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        by: ["method"],
        where: { paymentDate: { gte: dateFloor } },
      }),
    );
    expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith({
      where: { paymentDate: { gte: dateFloor } },
      _sum: { amount: true },
    });
  });

  it("uses the later of the 30-day lookback and the start date for the timeline", async () => {
    // Start (Jun 5) is INSIDE the 30-day window (since May 21) → floor wins.
    mockGetAnalyticsStartDateValue.mockResolvedValue("2026-06-05");

    await getDashboardStatsCached();

    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paymentDate: { gte: new Date("2026-06-05T00:00:00.000Z") } },
      }),
    );
  });

  it("keeps the 30-day lookback when the start date is older than 30 days", async () => {
    mockGetAnalyticsStartDateValue.mockResolvedValue("2026-01-01");

    await getDashboardStatsCached();

    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paymentDate: { gte: new Date("2026-05-21T10:00:00.000Z") } },
      }),
    );
  });

  it("ignores a malformed stored value instead of crashing", async () => {
    mockGetAnalyticsStartDateValue.mockResolvedValue("garbage");

    await getDashboardStatsCached();

    expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith({
      where: {},
      _sum: { amount: true },
    });
  });
});
