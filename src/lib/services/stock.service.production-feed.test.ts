/**
 * Production-entry feed (`listTodayProduction`) and shift attribution on
 * `recordProductionIn`, exercised at fixed wall-clock instants.
 *
 * Pins:
 *  - Outside the morning grace hour the feed is the current operational day.
 *  - Inside it (08:00–08:59) yesterday's EVENING shift is included, tagged
 *    `operationalDay: "previous"`, so a late-recorded entry stays visible.
 *  - A 20:0x entry back-dated to yesterday's MORNING is never resurfaced.
 *  - Previous-shift attribution is accepted for the full grace hour and
 *    rejected right after it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  stockLocation: { findUnique: vi.fn(), update: vi.fn() },
  sizeLookup: { findUnique: vi.fn() },
  steelClassification: { findUnique: vi.fn() },
  stockMovement: {
    findMany: vi.fn(),
    groupBy: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  auditLog: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./tx-retry", () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock("./audit.service", () => ({
  logAudit: vi.fn(async () => undefined),
}));
vi.mock("@/config/feature-flags", () => ({
  isStockModuleEnabled: () => true,
}));
vi.mock("./settings.service", () => ({
  clampEventWindow: vi.fn(async (from?: Date, to?: Date) => ({
    from,
    to,
    clamped: false,
    analyticsStartDate: null,
  })),
}));

import { listTodayProduction, recordProductionIn } from "./stock.service";

const USER_ID = 9;

/** Local wall-clock instant on 2026-09-<day>. */
function at(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 8, day, hour, minute, 0, 0);
}

function feedRow(
  id: number,
  createdAt: Date,
  shift: "MORNING" | "EVENING" | null,
  unit: "BUNDLE" | "TON" = "BUNDLE",
) {
  return {
    id,
    createdAt,
    type: "PRODUCTION_IN" as const,
    locationId: 22,
    sizeId: 10,
    grade: "FIRST" as const,
    quantity: unit === "BUNDLE" ? "3.000" : "4.500",
    unit,
    shift,
    reason: null,
    supersededById: null,
    location: { code: "A1", nameAr: "A1 أمامية", segment: "GENERAL" as const },
    size: { displayName: "10 مم" },
    classification: null,
    creator: { username: "clerk", fullName: "Clerk One" },
  };
}

function shortbarLocation() {
  return {
    id: 60,
    code: "S1",
    nameAr: "قصير 1",
    segment: "SHORTBAR" as const,
    unit: "TON" as const,
    isActive: true,
    isVirtual: false,
    allowedGrade: null,
    expectedSizeId: null,
    expectedSize: null,
    expectedClassificationId: null,
    expectedClassification: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    typeof fn === "function" ? fn(mockPrisma) : fn,
  );
  mockPrisma.stockMovement.create.mockImplementation(async () => ({ id: 100 }));
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.stockMovement.groupBy.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

function findManyArgs() {
  const call = mockPrisma.stockMovement.findMany.mock.calls[0]?.[0] as {
    where: { createdAt: { gte: Date } };
    take: number;
  };
  return call;
}

// ── Feed ────────────────────────────────────────────────────────────────────

describe("listTodayProduction — outside the morning grace hour", () => {
  it("queries from today's 08:00 and tags everything as current", async () => {
    vi.setSystemTime(at(15, 14, 0));
    mockPrisma.stockMovement.findMany.mockResolvedValue([
      feedRow(1, at(15, 13, 40), "MORNING"),
      feedRow(2, at(15, 8, 12), "MORNING"),
    ]);

    const items = await listTodayProduction();

    expect(findManyArgs().where.createdAt.gte).toEqual(at(15, 8, 0));
    expect(findManyArgs().take).toBe(500);
    expect(items.map((i) => [i.id, i.operationalDay])).toEqual([
      [1, "current"],
      [2, "current"],
    ]);
  });

  it("hides the 08:0x entry attributed to EVENING once the hour is over", async () => {
    vi.setSystemTime(at(15, 9, 30));
    mockPrisma.stockMovement.findMany.mockResolvedValue([
      feedRow(3, at(15, 9, 15), "MORNING"),
      feedRow(2, at(15, 8, 12), "MORNING"),
      feedRow(1, at(15, 8, 10), "EVENING"),
    ]);

    const items = await listTodayProduction();

    expect(findManyArgs().where.createdAt.gte).toEqual(at(15, 8, 0));
    expect(items.map((i) => i.id)).toEqual([3, 2]);
    expect(items.every((i) => i.operationalDay === "current")).toBe(true);
  });

  it("keeps the 20:00 override inside the same day during the evening grace", async () => {
    vi.setSystemTime(at(15, 20, 30));
    mockPrisma.stockMovement.findMany.mockResolvedValue([
      feedRow(2, at(15, 20, 20), "EVENING"),
      feedRow(1, at(15, 20, 10), "MORNING"), // late morning-shift entry
    ]);

    const items = await listTodayProduction();

    // No reach-back: the evening boundary never crosses an operational day.
    expect(findManyArgs().where.createdAt.gte).toEqual(at(15, 8, 0));
    expect(items.map((i) => [i.id, i.shift, i.operationalDay])).toEqual([
      [2, "EVENING", "current"],
      [1, "MORNING", "current"],
    ]);
  });
});

describe("listTodayProduction — inside the morning grace hour", () => {
  it("reaches back to yesterday 20:00 and tags the night shift as previous", async () => {
    vi.setSystemTime(at(15, 8, 30));
    mockPrisma.stockMovement.findMany.mockResolvedValue([
      feedRow(5, at(15, 8, 12), "MORNING"), // today
      feedRow(4, at(15, 8, 10), "EVENING"), // late night-shift entry, recorded this morning
      feedRow(3, at(15, 3, 0), null), // pre-column row → natural EVENING
      feedRow(2, at(14, 21, 0), "EVENING"), // ordinary night-shift entry
      feedRow(1, at(14, 20, 15), "MORNING"), // yesterday's late MORNING — already settled
    ]);

    const items = await listTodayProduction();

    expect(findManyArgs().where.createdAt.gte).toEqual(at(14, 20, 0));
    expect(items.map((i) => [i.id, i.shift, i.operationalDay])).toEqual([
      [5, "MORNING", "current"],
      [4, "EVENING", "previous"],
      [3, "EVENING", "previous"],
      [2, "EVENING", "previous"],
    ]);
  });

  it("still includes the night shift at the last grace minute (08:59)", async () => {
    vi.setSystemTime(at(15, 8, 59));
    mockPrisma.stockMovement.findMany.mockResolvedValue([
      feedRow(1, at(14, 23, 0), "EVENING"),
    ]);

    const items = await listTodayProduction();

    expect(findManyArgs().where.createdAt.gte).toEqual(at(14, 20, 0));
    expect(items).toHaveLength(1);
    expect(items[0].operationalDay).toBe("previous");
  });

  it("drops the reach-back exactly at 09:00", async () => {
    vi.setSystemTime(at(15, 9, 0));
    mockPrisma.stockMovement.findMany.mockResolvedValue([]);

    await listTodayProduction();

    expect(findManyArgs().where.createdAt.gte).toEqual(at(15, 8, 0));
  });
});

// ── Attribution on write ────────────────────────────────────────────────────

function shiftPassedToCreate(): unknown {
  const call = mockPrisma.stockMovement.create.mock.calls[0]?.[0] as {
    data: { shift: unknown };
  };
  return call.data.shift;
}

describe("recordProductionIn — shift attribution", () => {
  beforeEach(() => {
    mockPrisma.stockLocation.findUnique.mockResolvedValue(shortbarLocation());
  });

  const tonEntry = (shift: "MORNING" | "EVENING" | null) => ({
    locationId: 60,
    unit: "TON" as const,
    sizeId: null,
    quantity: 2.5,
    shift,
    reason: "test",
  });

  it("defaults to the natural shift when none is sent", async () => {
    vi.setSystemTime(at(15, 3, 0));
    await recordProductionIn(tonEntry(null), USER_ID);
    expect(shiftPassedToCreate()).toBe("EVENING");

    mockPrisma.stockMovement.create.mockClear();
    vi.setSystemTime(at(15, 14, 0));
    await recordProductionIn(tonEntry(null), USER_ID);
    expect(shiftPassedToCreate()).toBe("MORNING");
  });

  it("accepts the previous shift 45 minutes after the 08:00 boundary", async () => {
    vi.setSystemTime(at(15, 8, 45));
    await recordProductionIn(tonEntry("EVENING"), USER_ID);
    expect(shiftPassedToCreate()).toBe("EVENING");
  });

  it("accepts the previous shift at the last grace minute (08:59)", async () => {
    vi.setSystemTime(at(15, 8, 59));
    await recordProductionIn(tonEntry("EVENING"), USER_ID);
    expect(shiftPassedToCreate()).toBe("EVENING");
  });

  it("rejects the previous shift at 09:00 with the 60-minute message", async () => {
    vi.setSystemTime(at(15, 9, 0));
    await expect(
      recordProductionIn(tonEntry("EVENING"), USER_ID),
    ).rejects.toMatchObject({
      messageKey: "previousShiftAttributionWindowExpired",
      params: { graceMinutes: 60 },
    });
    expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();
  });

  it("accepts MORNING during the 20:00 grace and rejects it at 21:00", async () => {
    vi.setSystemTime(at(15, 20, 45));
    await recordProductionIn(tonEntry("MORNING"), USER_ID);
    expect(shiftPassedToCreate()).toBe("MORNING");

    mockPrisma.stockMovement.create.mockClear();
    vi.setSystemTime(at(15, 21, 0));
    await expect(
      recordProductionIn(tonEntry("MORNING"), USER_ID),
    ).rejects.toMatchObject({ messageKey: "previousShiftAttributionWindowExpired" });
  });

  it("always accepts the current shift, grace window or not", async () => {
    vi.setSystemTime(at(15, 8, 20));
    await recordProductionIn(tonEntry("MORNING"), USER_ID);
    expect(shiftPassedToCreate()).toBe("MORNING");

    mockPrisma.stockMovement.create.mockClear();
    vi.setSystemTime(at(15, 16, 0));
    await recordProductionIn(tonEntry("MORNING"), USER_ID);
    expect(shiftPassedToCreate()).toBe("MORNING");
  });
});
