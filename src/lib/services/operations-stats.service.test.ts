import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  truckOperation: {
    findMany: vi.fn(),
    groupBy: vi.fn(),
    count: vi.fn(),
  },
  customer: { findMany: vi.fn() },
  destination: { findMany: vi.fn() },
  systemSetting: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
  revalidateTag: vi.fn(),
}));

import {
  getOwnerStatsCached,
  getOpsStatsCached,
} from "./operations-stats.service";

describe("operations dashboard operational periods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 7, 9, 30, 0, 0));
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.destination.findMany.mockResolvedValue([]);
    mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
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
    // tonsByGrade); the prev-period/6-month calls fall back to the [] default.
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
        sessions: [],
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
        sessions: [],
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
        sessions: [],
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

  it("compares trends against the elapsed-equivalent slice of the previous period", async () => {
    const truck = (id: number, grossKg: number) => ({
      id,
      customerId: id,
      destinationId: null,
      grossWeightKg: grossKg,
      tareWeightKg: 10_000,
      closedAt: new Date(2026, 5, 7, 9, 0, 0, 0),
      operationalGrade: null,
      rounds: [],
      sessions: [],
    });

    mockPrisma.truckOperation.findMany
      // 1: completedInPeriod — 2 trucks, 20t total
      .mockResolvedValueOnce([truck(1, 20_000), truck(2, 20_000)])
      // 2: prevPeriod — 1 truck, 10t
      .mockResolvedValueOnce([truck(3, 20_000)]);

    const stats = await getOwnerStatsCached("today");

    // Now = 09:30 → elapsed 1.5h. Previous window must be yesterday
    // 08:00 → yesterday 09:30, NOT yesterday's full operational day.
    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          status: "Completed",
          closedAt: {
            gte: new Date(2026, 5, 6, 8, 0, 0, 0),
            lt: new Date(2026, 5, 6, 9, 30, 0, 0),
          },
        },
      }),
    );

    expect(stats.trends.completedTrucks).toEqual({ pct: 100, direction: "up" });
    expect(stats.trends.totalTons).toEqual({ pct: 100, direction: "up" });
    // Previous period had 1 customer, current has 2 → +100%.
    expect(stats.trends.servedCustomers).toEqual({ pct: 100, direction: "up" });
    // 0 destinations on both sides → flat with no ratio.
    expect(stats.trends.servedDestinations).toEqual({
      pct: null,
      direction: "flat",
    });
  });

  it("returns hourly activity for 'today' and daily activity for 'week'", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValueOnce([
      {
        id: 1,
        customerId: 1,
        destinationId: null,
        grossWeightKg: 20_000,
        tareWeightKg: 10_000,
        closedAt: new Date(2026, 5, 7, 9, 15, 0, 0),
        operationalGrade: null,
        rounds: [],
        sessions: [],
      },
    ]);

    const today = await getOwnerStatsCached("today");
    expect(today.activity.granularity).toBe("hour");
    expect(today.activity.points).toHaveLength(24);
    // Series starts at the 08:00 cutoff and the 09:15 truck lands in 09:00.
    expect(today.activity.points[0].label).toBe("08:00");
    expect(today.activity.points[1]).toMatchObject({
      label: "09:00",
      trucks: 1,
      tons: 10,
    });

    vi.clearAllMocks();
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.destination.findMany.mockResolvedValue([]);
    mockPrisma.systemSetting.findUnique.mockResolvedValue(null);

    // Clock = Sunday 2026-06-07 → Levant week started Saturday 2026-06-06
    // → activity buckets = Sat + Sun (2 days so far).
    const week = await getOwnerStatsCached("week");
    expect(week.activity.granularity).toBe("day");
    expect(week.activity.points).toHaveLength(2);
    expect(week.activity.points[0].key).toBe("2026-06-06");
    expect(week.activity.points[1].key).toBe("2026-06-07");
  });

  it("reports a null-pct upward trend when the previous period was empty", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValueOnce([
      {
        id: 1,
        customerId: 1,
        destinationId: null,
        grossWeightKg: 20_000,
        tareWeightKg: 10_000,
        closedAt: new Date(2026, 5, 7, 9, 0, 0, 0),
        operationalGrade: null,
        rounds: [],
        sessions: [],
      },
    ]);

    const stats = await getOwnerStatsCached("today");

    expect(stats.trends.completedTrucks).toEqual({
      pct: null,
      direction: "up",
    });
  });

  it("computes factory pulse: today's tonnage racing the pre-today record", async () => {
    mockPrisma.truckOperation.findMany
      // 1: completedInPeriod — one truck today, 10t
      .mockResolvedValueOnce([
        {
          id: 1,
          customerId: 1,
          destinationId: null,
          grossWeightKg: 20_000,
          tareWeightKg: 10_000,
          closedAt: new Date(2026, 5, 7, 9, 0, 0, 0),
          operationalGrade: null,
          rounds: [],
          sessions: [],
        },
      ])
      // 2: prevPeriod, 3: recent ticker feed
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      // 4: best-day history scan — 20t on Jun 1 (before today)
      .mockResolvedValueOnce([
        {
          grossWeightKg: 30_000,
          tareWeightKg: 10_000,
          closedAt: new Date(2026, 5, 1, 12, 0, 0, 0),
        },
      ]);

    const stats = await getOwnerStatsCached("today");

    expect(stats.pulse.todayTons).toBe(10);
    expect(stats.pulse.todayTrucks).toBe(1);
    expect(stats.pulse.bestDay?.tons).toBe(20);
    expect(stats.pulse.pctOfRecord).toBe(50);
    expect(stats.pulse.recordBroken).toBe(false);
  });

  it("flags a broken record when today exceeds the historical best day", async () => {
    mockPrisma.truckOperation.findMany
      // 1: completedInPeriod — 30t today
      .mockResolvedValueOnce([
        {
          id: 1,
          customerId: 1,
          destinationId: null,
          grossWeightKg: 40_000,
          tareWeightKg: 10_000,
          closedAt: new Date(2026, 5, 7, 9, 0, 0, 0),
          operationalGrade: null,
          rounds: [],
          sessions: [],
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      // 4: best-day history — record was 20t
      .mockResolvedValueOnce([
        {
          grossWeightKg: 30_000,
          tareWeightKg: 10_000,
          closedAt: new Date(2026, 5, 1, 12, 0, 0, 0),
        },
      ]);

    const stats = await getOwnerStatsCached("today");

    expect(stats.pulse.recordBroken).toBe(true);
    expect(stats.pulse.pctOfRecord).toBe(150);
    // The record target stays at the pre-today best — it never moves to
    // today's own total mid-day.
    expect(stats.pulse.bestDay?.tons).toBe(20);
  });

  it("uses Levant Saturday-start week and calendar-month windows", async () => {
    // Clock = Sunday 2026-06-07 → current week from Saturday 2026-06-06 08:00
    await getOwnerStatsCached("week");
    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          status: "Completed",
          closedAt: { gte: new Date(2026, 5, 6, 8, 0, 0, 0) },
        },
      }),
    );
    // Previous week = previous Saturday → elapsed-equivalent cut.
    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          status: "Completed",
          closedAt: {
            gte: new Date(2026, 4, 30, 8, 0, 0, 0),
            lt: new Date(2026, 4, 31, 9, 30, 0, 0),
          },
        },
      }),
    );

    vi.clearAllMocks();
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.destination.findMany.mockResolvedValue([]);
    mockPrisma.systemSetting.findUnique.mockResolvedValue(null);

    // Thursday mid-week still anchors to that week's Saturday.
    vi.setSystemTime(new Date(2026, 5, 11, 14, 0, 0, 0));
    await getOwnerStatsCached("week");
    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          status: "Completed",
          closedAt: { gte: new Date(2026, 5, 6, 8, 0, 0, 0) },
        },
      }),
    );

    vi.clearAllMocks();
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.destination.findMany.mockResolvedValue([]);
    mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
    vi.setSystemTime(new Date(2026, 5, 7, 9, 30, 0, 0));

    // Month = from the 1st of the operational month, not a rolling 30 days.
    await getOwnerStatsCached("month");
    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          status: "Completed",
          closedAt: { gte: new Date(2026, 5, 1, 8, 0, 0, 0) },
        },
      }),
    );
  });

  it("clamps every window to the analytics start date and drops dirty trends", async () => {
    // Mid-month clock would still start the calendar month on the 1st;
    // with analytics start on 2026-06-05 the main window is raised.
    vi.setSystemTime(new Date(2026, 5, 20, 10, 0, 0, 0));
    mockPrisma.systemSetting.findUnique.mockResolvedValue({
      value: "2026-06-05",
    });

    const stats = await getOwnerStatsCached("month");

    // Main window clamped to the analytics start cutoff (not June 1).
    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          status: "Completed",
          closedAt: { gte: new Date(2026, 5, 5, 8, 0, 0, 0) },
        },
      }),
    );

    // Previous-period window lies before the start → no trend arrows.
    expect(stats.trends.totalTons).toEqual({ pct: null, direction: "flat" });
    expect(stats.trends.completedTrucks).toEqual({
      pct: null,
      direction: "flat",
    });

    expect(stats.analyticsStartDate).toBe("2026-06-05");

    // Recent-deliveries feed (3rd query) is floored at the start too.
    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: {
          status: "Completed",
          closedAt: { not: null, gte: new Date(2026, 5, 5, 8, 0, 0, 0) },
        },
      }),
    );

    // Best-day record scan (4th query) never reaches into the excluded era.
    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        where: {
          status: "Completed",
          closedAt: { not: null, gte: new Date(2026, 5, 5, 8, 0, 0, 0) },
        },
      }),
    );

    // Live-floor hero counters (5th query) exclude trucks REGISTERED
    // before the start — stale pre-rollout trucks stuck in an active
    // status must not show up in "الآن في المصنع".
    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: new Date(2026, 5, 5, 8, 0, 0, 0) },
        }),
      }),
    );
  });

  it("builds the live floor snapshot from active trucks", async () => {
    // Promise.all order: period, prev, recent, bestDay, activeFloor.
    mockPrisma.truckOperation.findMany
      .mockResolvedValueOnce([]) // completedInPeriod
      .mockResolvedValueOnce([]) // prevPeriod
      .mockResolvedValueOnce([]) // recentCompleted
      .mockResolvedValueOnce([]) // bestDay history
      .mockResolvedValueOnce([
        {
          plateNumber: "Q-050",
          status: "Queued",
          createdAt: new Date(2026, 5, 7, 9, 0, 0, 0),
          updatedAt: new Date(2026, 5, 7, 9, 0, 0, 0),
        },
        {
          plateNumber: "A-100",
          status: "OnScale",
          createdAt: new Date(2026, 5, 7, 8, 0, 0, 0),
          // 10 min on internal scale — under the 30 min stuck threshold
          updatedAt: new Date(2026, 5, 7, 9, 20, 0, 0),
        },
        {
          plateNumber: "B-200",
          status: "FirstWeigh",
          createdAt: new Date(2026, 5, 7, 8, 0, 0, 0),
          // 10 min after tare — under the 20 min stuck threshold
          updatedAt: new Date(2026, 5, 7, 9, 20, 0, 0),
        },
        {
          // 95 min in Loading → past the 90 min stuck threshold
          // (still active, but not counted in either hero card)
          plateNumber: "C-300",
          status: "Loading",
          createdAt: new Date(2026, 5, 7, 7, 0, 0, 0),
          updatedAt: new Date(2026, 5, 7, 7, 55, 0, 0),
        },
      ]);

    const stats = await getOwnerStatsCached("today");

    expect(stats.pulse.liveFloor.activeNow).toBe(4);
    expect(stats.pulse.liveFloor.queuedNow).toBe(1);
    // Internal weighbridge = OnScale only.
    expect(stats.pulse.liveFloor.loadingNow).toBe(1);
    // External weighbridge / tare done = FirstWeigh.
    expect(stats.pulse.liveFloor.tareNow).toBe(1);
    expect(stats.pulse.liveFloor.stuckNow).toBe(1);
    expect(stats.pulse.liveFloor.longestDwell?.plateNumber).toBe("C-300");
    expect(stats.pulse.liveFloor.longestDwell?.minutesSince).toBe(95);
  });
});

// ─── Ops tier — fleet status & 30-day windows ─────────────────────────

describe("ops dashboard analytics-start clamping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 20, 10, 0, 0, 0));
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    mockPrisma.truckOperation.groupBy.mockResolvedValue([]);
    mockPrisma.truckOperation.count.mockResolvedValue(0);
    mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts all trucks in the fleet pie when no start date is configured", async () => {
    await getOpsStatsCached();

    expect(mockPrisma.truckOperation.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ["status"], where: {} }),
    );
  });

  it("floors every fleet-pie bucket at the analytics start, including active trucks", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({
      value: "2026-06-05",
    });
    const analyticsStart = new Date(2026, 5, 5, 8, 0, 0, 0);

    await getOpsStatsCached();

    expect(mockPrisma.truckOperation.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["status"],
        where: {
          OR: [
            // Active statuses: floored by REGISTRATION — pre-rollout trucks
            // abandoned mid-flight must not appear.
            {
              status: {
                in: [
                  "Queued",
                  "Approved",
                  "FirstWeigh",
                  "Loading",
                  "OnScale",
                  "LoadingComplete",
                  "SecondWeigh",
                ],
              },
              createdAt: { gte: analyticsStart },
            },
            // Terminal statuses: floored by their end timestamps.
            { status: "Completed", closedAt: { gte: analyticsStart } },
            { status: "Cancelled", updatedAt: { gte: analyticsStart } },
          ],
        },
      }),
    );

    // The on-scale / stuck-truck live snapshot shares the same floor.
    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: analyticsStart },
        }),
      }),
    );
  });

  it("raises the 30-day averages window to the analytics start", async () => {
    // 30-day lookback from Jun 20 reaches May 22 — before the Jun 5 start.
    mockPrisma.systemSetting.findUnique.mockResolvedValue({
      value: "2026-06-05",
    });
    const analyticsStart = new Date(2026, 5, 5, 8, 0, 0, 0);

    await getOpsStatsCached();

    // completed30d (findMany #2 — after the activeTrucks snapshot).
    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { status: "Completed", closedAt: { gte: analyticsStart } },
      }),
    );
    // cancelled30d count shares the same floor.
    expect(mockPrisma.truckOperation.count).toHaveBeenCalledWith({
      where: { status: "Cancelled", updatedAt: { gte: analyticsStart } },
    });
  });
});

// ─── Owner KPIs, rankings, period edges ───────────────────────────────

function completedTruck(opts: {
  id: number;
  customerId?: number | null;
  destinationId?: number | null;
  grossKg: number;
  tareKg?: number;
  closedAt: Date;
  operationalGrade?: "FIRST" | "SECOND" | null;
  rounds?: {
    grade: "FIRST" | "SECOND" | null;
    startWeightKg: number;
    endWeightKg: number;
  }[];
  sessions?: { weightTons: number; size: { code: string } | null }[];
}) {
  return {
    id: opts.id,
    customerId: opts.customerId ?? null,
    destinationId: opts.destinationId ?? null,
    grossWeightKg: opts.grossKg,
    tareWeightKg: opts.tareKg ?? 10_000,
    closedAt: opts.closedAt,
    operationalGrade: opts.operationalGrade ?? null,
    rounds: opts.rounds ?? [],
    sessions: opts.sessions ?? [],
  };
}

describe("owner dashboard KPIs and rankings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 7, 9, 30, 0, 0));
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.destination.findMany.mockResolvedValue([]);
    mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aggregates owner KPI cards: trucks, tons, unique customers & destinations", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValueOnce([
      completedTruck({
        id: 1,
        customerId: 10,
        destinationId: 100,
        grossKg: 30_000,
        closedAt: new Date(2026, 5, 7, 9, 0, 0, 0),
      }),
      completedTruck({
        id: 2,
        customerId: 10, // same customer
        destinationId: 200,
        grossKg: 20_000,
        closedAt: new Date(2026, 5, 7, 9, 10, 0, 0),
      }),
      completedTruck({
        id: 3,
        customerId: 20,
        destinationId: null,
        grossKg: 18_000,
        closedAt: new Date(2026, 5, 7, 9, 20, 0, 0),
      }),
      // Malformed weights must never drag totalTons negative.
      completedTruck({
        id: 4,
        customerId: 30,
        destinationId: 100,
        grossKg: 5_000,
        tareKg: 10_000,
        closedAt: new Date(2026, 5, 7, 9, 25, 0, 0),
      }),
    ]);

    const stats = await getOwnerStatsCached("today");

    expect(stats.kpis).toEqual({
      completedTrucks: 4,
      totalTons: 38, // 20 + 10 + 8 + 0
      servedCustomers: 3,
      servedDestinations: 2,
    });
  });

  it("ranks top customers and destinations by tonnage (top 5)", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValueOnce([
      completedTruck({
        id: 1,
        customerId: 1,
        destinationId: 11,
        grossKg: 40_000,
        closedAt: new Date(2026, 5, 7, 9, 0, 0, 0),
      }),
      completedTruck({
        id: 2,
        customerId: 2,
        destinationId: 11,
        grossKg: 20_000,
        closedAt: new Date(2026, 5, 7, 9, 5, 0, 0),
      }),
      completedTruck({
        id: 3,
        customerId: 1,
        destinationId: 22,
        grossKg: 15_000,
        closedAt: new Date(2026, 5, 7, 9, 10, 0, 0),
      }),
    ]);
    mockPrisma.customer.findMany.mockResolvedValue([
      { id: 1, fullName: "زبون أ", code: "C1" },
      { id: 2, fullName: "زبون ب", code: "C2" },
    ]);
    mockPrisma.destination.findMany.mockResolvedValue([
      { id: 11, name: "دمشق" },
      { id: 22, name: "حلب" },
    ]);

    const stats = await getOwnerStatsCached("today");

    expect(stats.topCustomers).toEqual([
      { id: 1, name: "زبون أ", code: "C1", tons: 35 }, // 30 + 5
      { id: 2, name: "زبون ب", code: "C2", tons: 10 },
    ]);
    expect(stats.topDestinations).toEqual([
      { id: 11, name: "دمشق", tons: 40 }, // 30 + 10
      { id: 22, name: "حلب", tons: 5 },
    ]);
  });

  it("maps weigh-session size codes into tonsByKind buckets", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValueOnce([
      completedTruck({
        id: 1,
        customerId: 1,
        destinationId: null,
        grossKg: 30_000,
        closedAt: new Date(2026, 5, 7, 9, 0, 0, 0),
        sessions: [
          { weightTons: 12, size: { code: "12" } }, // REBAR
          { weightTons: 3, size: { code: "scrap" } },
          { weightTons: 2, size: { code: "shortbar_1_4m" } },
        ],
      }),
    ]);

    const stats = await getOwnerStatsCached("today");

    expect(stats.tonsByKind).toEqual(
      expect.arrayContaining([
        { kind: "REBAR", label: "مبروم", tons: 12 },
        { kind: "SCRAP", label: "خردة", tons: 3 },
        { kind: "SHORTBAR_1_4M", label: "قصائر 1–4 م", tons: 2 },
      ]),
    );
    expect(stats.tonsByKind).toHaveLength(3);
  });

  it("builds recent deliveries newest-first with rounded tons", async () => {
    // Promise.all: period, prev, recent, bestDay, activeFloor
    mockPrisma.truckOperation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 9,
          plateNumber: "XYZ-9",
          grossWeightKg: 25_500,
          tareWeightKg: 10_000,
          closedAt: new Date(2026, 5, 7, 9, 0, 0, 0),
          customer: { fullName: "شركة الحديد" },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const stats = await getOwnerStatsCached("today");

    expect(stats.recentDeliveries).toEqual([
      {
        id: 9,
        plateNumber: "XYZ-9",
        tons: 15.5,
        customerName: "شركة الحديد",
        closedAt: new Date(2026, 5, 7, 9, 0, 0, 0).toISOString(),
      },
    ]);
  });
});

describe("owner dashboard period boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.destination.findMany.mockResolvedValue([]);
    mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("treats 07:59 as still belonging to the previous operational day", async () => {
    // Before 08:00 → operational "today" started yesterday at 08:00.
    vi.setSystemTime(new Date(2026, 5, 7, 7, 59, 0, 0));

    await getOwnerStatsCached("today");

    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          status: "Completed",
          closedAt: { gte: new Date(2026, 5, 6, 8, 0, 0, 0) },
        },
      }),
    );
  });

  it("mirrors month trends into the previous calendar month (elapsed-equivalent)", async () => {
    // June 20 10:00 → month from Jun 1 08:00; previous = May 1 08:00 → May 20 10:00
    vi.setSystemTime(new Date(2026, 5, 20, 10, 0, 0, 0));

    await getOwnerStatsCached("month");

    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          status: "Completed",
          closedAt: {
            gte: new Date(2026, 4, 1, 8, 0, 0, 0),
            lt: new Date(2026, 4, 20, 10, 0, 0, 0),
          },
        },
      }),
    );
  });

  it("sizes month activity as one bucket per operational day from the 1st", async () => {
    vi.setSystemTime(new Date(2026, 5, 7, 9, 30, 0, 0));

    const stats = await getOwnerStatsCached("month");

    expect(stats.activity.granularity).toBe("day");
    // Jun 1 … Jun 7 inclusive = 7 days
    expect(stats.activity.points).toHaveLength(7);
    expect(stats.activity.points[0].key).toBe("2026-06-01");
    expect(stats.activity.points[6].key).toBe("2026-06-07");
  });

  it("when period is week/month, pulse.todayTons only counts today's slice", async () => {
    vi.setSystemTime(new Date(2026, 5, 7, 9, 30, 0, 0));
    mockPrisma.truckOperation.findMany.mockResolvedValueOnce([
      // Yesterday (still inside the week window) — must NOT enter pulse.today*
      completedTruck({
        id: 1,
        customerId: 1,
        grossKg: 40_000,
        closedAt: new Date(2026, 5, 6, 12, 0, 0, 0),
      }),
      // Today
      completedTruck({
        id: 2,
        customerId: 2,
        grossKg: 20_000,
        closedAt: new Date(2026, 5, 7, 9, 0, 0, 0),
      }),
    ]);

    const stats = await getOwnerStatsCached("week");

    expect(stats.kpis.completedTrucks).toBe(2);
    expect(stats.kpis.totalTons).toBe(40);
    expect(stats.pulse.todayTrucks).toBe(1);
    expect(stats.pulse.todayTons).toBe(10);
  });

  it("ignores a malformed analytics start date instead of crashing", async () => {
    vi.setSystemTime(new Date(2026, 5, 7, 9, 30, 0, 0));
    mockPrisma.systemSetting.findUnique.mockResolvedValue({
      value: "not-a-date",
    });

    const stats = await getOwnerStatsCached("today");

    expect(stats.analyticsStartDate).toBe("not-a-date");
    // Window stays at today's operational cutoff (no clamp applied).
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

  it("returns empty live floor when no active trucks exist", async () => {
    vi.setSystemTime(new Date(2026, 5, 7, 9, 30, 0, 0));
    mockPrisma.truckOperation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const stats = await getOwnerStatsCached("today");

    expect(stats.pulse.liveFloor).toEqual({
      activeNow: 0,
      queuedNow: 0,
      loadingNow: 0,
      tareNow: 0,
      stuckNow: 0,
      longestDwell: null,
    });
  });
});

// ─── Ops tier — live cards matching the UI ────────────────────────────

describe("ops dashboard live cards and averages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 20, 10, 0, 0, 0));
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    mockPrisma.truckOperation.groupBy.mockResolvedValue([]);
    mockPrisma.truckOperation.count.mockResolvedValue(0);
    mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes حالة العمليات الآن: activeNow, onScaleNow, stuckNow", async () => {
    mockPrisma.truckOperation.groupBy.mockResolvedValue([
      { status: "Queued", _count: { status: 4 } },
      { status: "FirstWeigh", _count: { status: 2 } },
      { status: "OnScale", _count: { status: 3 } },
      { status: "Loading", _count: { status: 1 } },
      { status: "Completed", _count: { status: 50 } },
      { status: "Cancelled", _count: { status: 5 } },
    ]);
    mockPrisma.truckOperation.findMany
      // 1: active trucks snapshot
      .mockResolvedValueOnce([
        {
          id: 1,
          plateNumber: "A-1",
          status: "OnScale",
          createdAt: new Date(2026, 5, 20, 9, 0, 0, 0),
          tareTime: null,
          loadingConfirmedAt: null,
          grossTime: null,
          // 40 min on scale → past 30 min threshold
          updatedAt: new Date(2026, 5, 20, 9, 20, 0, 0),
        },
        {
          id: 2,
          plateNumber: "B-2",
          status: "OnScale",
          createdAt: new Date(2026, 5, 20, 9, 40, 0, 0),
          tareTime: null,
          loadingConfirmedAt: null,
          grossTime: null,
          // 10 min — not stuck
          updatedAt: new Date(2026, 5, 20, 9, 50, 0, 0),
        },
        {
          id: 3,
          plateNumber: "C-3",
          status: "Queued",
          createdAt: new Date(2026, 5, 20, 8, 0, 0, 0),
          tareTime: null,
          loadingConfirmedAt: null,
          grossTime: null,
          // 70 min queued → past 60 min threshold
          updatedAt: new Date(2026, 5, 20, 8, 50, 0, 0),
        },
        {
          id: 4,
          plateNumber: "D-4",
          status: "FirstWeigh",
          createdAt: new Date(2026, 5, 20, 9, 50, 0, 0),
          tareTime: null,
          loadingConfirmedAt: null,
          grossTime: null,
          // 5 min — not stuck (threshold 20)
          updatedAt: new Date(2026, 5, 20, 9, 55, 0, 0),
        },
      ])
      // 2: completed30d
      .mockResolvedValueOnce([]);

    const stats = await getOpsStatsCached();

    // Active statuses only (Queued+FirstWeigh+OnScale+Loading) = 4+2+3+1
    expect(stats.kpis.activeNow).toBe(10);
    expect(stats.kpis.onScaleNow).toBe(3);
    expect(stats.kpis.stuckNow).toBe(2);
    expect(stats.stuckTrucks.map((t) => t.plateNumber)).toEqual(["C-3", "A-1"]);
    expect(stats.onScale).toHaveLength(2);
    expect(stats.onScale[0].plateNumber).toBe("A-1"); // longest first
  });

  it("computes cancellationPct30d = cancelled / (completed + cancelled)", async () => {
    mockPrisma.truckOperation.findMany
      .mockResolvedValueOnce([]) // active
      .mockResolvedValueOnce([
        // 3 completed in the 30d window
        {
          createdAt: new Date(2026, 5, 10, 8, 0, 0, 0),
          tareTime: new Date(2026, 5, 10, 8, 30, 0, 0),
          loadingConfirmedAt: new Date(2026, 5, 10, 9, 30, 0, 0),
          grossTime: new Date(2026, 5, 10, 10, 0, 0, 0),
          closedAt: new Date(2026, 5, 10, 10, 0, 0, 0),
        },
        {
          createdAt: new Date(2026, 5, 11, 8, 0, 0, 0),
          tareTime: new Date(2026, 5, 11, 8, 20, 0, 0),
          loadingConfirmedAt: new Date(2026, 5, 11, 9, 0, 0, 0),
          grossTime: null,
          closedAt: new Date(2026, 5, 11, 9, 30, 0, 0),
        },
        {
          createdAt: new Date(2026, 5, 12, 8, 0, 0, 0),
          tareTime: null,
          loadingConfirmedAt: null,
          grossTime: null,
          closedAt: new Date(2026, 5, 12, 10, 0, 0, 0),
        },
      ]);
    mockPrisma.truckOperation.count.mockResolvedValue(1); // 1 cancelled

    const stats = await getOpsStatsCached();

    // 1 / (3+1) = 25%
    expect(stats.kpis.cancellationPct30d).toBe(25);
    // cycle: truck1 120min, truck2 90min, truck3 120min → avg 110
    expect(stats.averages30d.avgCycleMin).toBe(110);
    // wait before tare: truck1 30, truck2 20 → avg 25
    expect(stats.averages30d.avgWaitBeforeTareMin).toBe(25);
    // loading (tare→loadingConfirmed): truck1 60, truck2 40 → avg 50
    expect(stats.averages30d.avgLoadingMin).toBe(50);
  });

  it("returns null cancellation and averages when the 30d window is empty", async () => {
    const stats = await getOpsStatsCached();

    expect(stats.kpis.cancellationPct30d).toBeNull();
    expect(stats.averages30d).toEqual({
      avgCycleMin: null,
      avgWaitBeforeTareMin: null,
      avgLoadingMin: null,
    });
    expect(stats.kpis.activeNow).toBe(0);
    expect(stats.kpis.onScaleNow).toBe(0);
    expect(stats.kpis.stuckNow).toBe(0);
    expect(stats.fleetStatus).toEqual([]);
  });

  it("omits zero-count statuses from the fleet pie", async () => {
    mockPrisma.truckOperation.groupBy.mockResolvedValue([
      { status: "OnScale", _count: { status: 2 } },
      { status: "Completed", _count: { status: 10 } },
    ]);

    const stats = await getOpsStatsCached();

    expect(stats.fleetStatus.map((b) => b.status)).toEqual([
      "OnScale",
      "Completed",
    ]);
    expect(stats.fleetStatus.every((b) => b.count > 0)).toBe(true);
  });

  it("keeps the full 30-day lookback when analytics start is older than 30 days", async () => {
    // Clock Jun 20 → 30d lookback = May 22 08:00. Start on May 1 is older.
    mockPrisma.systemSetting.findUnique.mockResolvedValue({
      value: "2026-05-01",
    });

    await getOpsStatsCached();

    expect(mockPrisma.truckOperation.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          status: "Completed",
          closedAt: { gte: new Date(2026, 4, 22, 8, 0, 0, 0) },
        },
      }),
    );
  });
});
