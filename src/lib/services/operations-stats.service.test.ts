import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  truckOperation: {
    findMany: vi.fn(),
    groupBy: vi.fn(),
    count: vi.fn(),
  },
  customer: { findMany: vi.fn() },
  destination: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

import { getOwnerStatsCached } from "./operations-stats.service";

describe("operations dashboard operational periods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 7, 9, 30, 0, 0));
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.destination.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts today's dashboard KPIs at the 08:00 operational cutoff", async () => {
    await getOwnerStatsCached("today");

    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          status: "Completed",
          closedAt: { gte: new Date(2026, 5, 7, 8, 0, 0, 0) },
        },
      }),
    );
  });

  it("splits tonsByGrade per bridge round, with operationalGrade fallback for legacy trucks", async () => {
    // First findMany call = completedInPeriod (the only one that feeds
    // tonsByGrade); the 14d/30d calls fall back to the [] default.
    mockPrisma.truckOperation.findMany.mockResolvedValueOnce([
      // Multi-round truck: 15t FIRST + 5t SECOND in one visit.
      {
        id: 1,
        customerId: 1,
        destinationId: null,
        grossWeightKg: 30_000,
        tareWeightKg: 10_000,
        closedAt: new Date(2026, 5, 7, 9, 0, 0, 0),
        operationalGrade: null,
        rounds: [
          { grade: "FIRST", startWeightKg: 10_000, endWeightKg: 25_000 },
          { grade: "SECOND", startWeightKg: 25_000, endWeightKg: 30_000 },
        ],
      },
      // Legacy truck (pre-migration, no rounds): falls back to operationalGrade.
      {
        id: 2,
        customerId: 2,
        destinationId: null,
        grossWeightKg: 22_000,
        tareWeightKg: 10_000,
        closedAt: new Date(2026, 5, 7, 9, 30, 0, 0),
        operationalGrade: "FIRST",
        rounds: [],
      },
      // Grade-less round (e.g. scrap) contributes to no grade bucket.
      {
        id: 3,
        customerId: 3,
        destinationId: null,
        grossWeightKg: 18_000,
        tareWeightKg: 10_000,
        closedAt: new Date(2026, 5, 7, 9, 45, 0, 0),
        operationalGrade: null,
        rounds: [{ grade: null, startWeightKg: 10_000, endWeightKg: 18_000 }],
      },
    ]);

    const stats = await getOwnerStatsCached("today");

    expect(stats.tonsByGrade).toEqual([
      { grade: "FIRST", label: "درجة أولى", tons: 27 },
      { grade: "SECOND", label: "درجة ثانية", tons: 5 },
    ]);
    // KPI total still uses the operation-level net (whole visits).
    expect(stats.kpis.totalTons).toBe(40);
  });

  it("uses operational-day starts for week and month windows", async () => {
    await getOwnerStatsCached("week");
    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          status: "Completed",
          closedAt: { gte: new Date(2026, 5, 1, 8, 0, 0, 0) },
        },
      }),
    );

    vi.clearAllMocks();
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.destination.findMany.mockResolvedValue([]);

    await getOwnerStatsCached("month");
    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          status: "Completed",
          closedAt: { gte: new Date(2026, 4, 9, 8, 0, 0, 0) },
        },
      }),
    );
  });
});
