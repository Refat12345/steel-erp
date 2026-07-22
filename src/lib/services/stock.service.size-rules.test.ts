/**
 * One-size / expectedSize rules for finished-goods stock.
 *
 * Pins:
 *  - Empty GENERAL/GOVERNORATES bay: inbound, adjust(+), and transfer-in
 *    must match location.expectedSize when configured.
 *  - Occupying positive BUNDLE balance wins over expectedSize.
 *  - ISOLATION is multi-size and skips the rule.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  stockLocation: { findUnique: vi.fn() },
  sizeLookup: { findUnique: vi.fn() },
  stockMovement: {
    groupBy: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
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

import {
  recordProductionIn,
  recordTransfer,
  recordAdjustment,
} from "./stock.service";
import { ServiceError } from "./errors";

const USER_ID = 9;
const SIZE_10 = { id: 10, displayName: "10 مم" };
const SIZE_12 = { id: 12, displayName: "12 مم" };

function generalLocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 22,
    code: "A1",
    nameAr: "A1 أمامية",
    segment: "GENERAL" as const,
    unit: "BUNDLE" as const,
    isActive: true,
    isVirtual: false,
    allowedGrade: "FIRST" as const,
    expectedSizeId: SIZE_10.id,
    expectedSize: SIZE_10,
    ...overrides,
  };
}

function isolationLocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 40,
    code: "I1",
    nameAr: "عزل 1",
    segment: "ISOLATION" as const,
    unit: "BUNDLE" as const,
    isActive: true,
    isVirtual: false,
    allowedGrade: "SECOND" as const,
    expectedSizeId: SIZE_10.id,
    expectedSize: SIZE_10,
    ...overrides,
  };
}

let nextMovementId = 100;

beforeEach(() => {
  vi.clearAllMocks();
  nextMovementId = 100;
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    typeof fn === "function" ? fn(mockPrisma) : fn,
  );
  mockPrisma.stockMovement.create.mockImplementation(async () => ({
    id: nextMovementId++,
  }));
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.sizeLookup.findUnique.mockImplementation(
    async ({ where }: { where: { id: number } }) => {
      if (where.id === SIZE_10.id) return SIZE_10;
      if (where.id === SIZE_12.id) return SIZE_12;
      return null;
    },
  );
});

// ── Production-in ───────────────────────────────────────────────────────────

describe("recordProductionIn — expectedSize / one-size", () => {
  it("rejects a wrong size on an empty bay with expectedSize set", async () => {
    const loc = generalLocation();
    mockPrisma.stockLocation.findUnique.mockResolvedValue(loc);
    // Empty of positive bundles
    mockPrisma.stockMovement.groupBy.mockResolvedValue([]);

    await expect(
      recordProductionIn(
        {
          locationId: loc.id,
          unit: "BUNDLE",
          sizeId: SIZE_12.id,
          quantity: 2,
          reason: "wrong-size",
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({
      messageKey: "locationSizeMustMatchExpected",
      params: { locationName: loc.nameAr, sizeName: SIZE_10.displayName },
    } satisfies Partial<ServiceError>);

    expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();
  });

  it("accepts the expected size on an empty bay", async () => {
    const loc = generalLocation();
    mockPrisma.stockLocation.findUnique.mockResolvedValue(loc);
    mockPrisma.stockMovement.groupBy
      // one-size check
      .mockResolvedValueOnce([])
      // imbalance check after create (bundles only → warn tons missing)
      .mockResolvedValueOnce([
        { unit: "BUNDLE", _sum: { quantity: 2 } },
      ]);

    const result = await recordProductionIn(
      {
        locationId: loc.id,
        unit: "BUNDLE",
        sizeId: SIZE_10.id,
        quantity: 2,
        reason: "ok",
      },
      USER_ID,
    );

    expect(result.movementId).toBe(100);
    expect(mockPrisma.stockMovement.create).toHaveBeenCalledTimes(1);
  });

  it("lets the occupying bundle size win over a stale expectedSize", async () => {
    const loc = generalLocation({
      // Config still says 10mm, but ground stock is 12mm
      expectedSizeId: SIZE_10.id,
      expectedSize: SIZE_10,
    });
    mockPrisma.stockLocation.findUnique.mockResolvedValue(loc);
    mockPrisma.stockMovement.groupBy
      .mockResolvedValueOnce([
        { sizeId: SIZE_12.id, _sum: { quantity: 5 } },
      ])
      .mockResolvedValueOnce([
        { unit: "BUNDLE", _sum: { quantity: 7 } },
        { unit: "TON", _sum: { quantity: 12 } },
      ]);

    const result = await recordProductionIn(
      {
        locationId: loc.id,
        unit: "BUNDLE",
        sizeId: SIZE_12.id,
        quantity: 2,
        reason: "continue-occupying",
      },
      USER_ID,
    );

    expect(result.movementId).toBe(100);
  });

  it("blocks a different size while the bay holds another positive bundle balance", async () => {
    const loc = generalLocation();
    mockPrisma.stockLocation.findUnique.mockResolvedValue(loc);
    mockPrisma.stockMovement.groupBy.mockResolvedValue([
      { sizeId: SIZE_10.id, _sum: { quantity: 4 } },
    ]);

    await expect(
      recordProductionIn(
        {
          locationId: loc.id,
          unit: "BUNDLE",
          sizeId: SIZE_12.id,
          quantity: 1,
          reason: "mix",
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({
      messageKey: "locationHasOtherSizeEmptyFirst",
      params: { locationName: loc.nameAr, sizeName: SIZE_10.displayName },
    });
  });

  it("skips expectedSize enforcement in the ISOLATION multi-size zone", async () => {
    const loc = isolationLocation();
    mockPrisma.stockLocation.findUnique.mockResolvedValue(loc);
    // ISOLATION never runs the one-size/expectedSize branch — only imbalance groupBy
    mockPrisma.stockMovement.groupBy.mockResolvedValueOnce([
      { unit: "BUNDLE", _sum: { quantity: 1 } },
      { unit: "TON", _sum: { quantity: 2 } },
    ]);

    const result = await recordProductionIn(
      {
        locationId: loc.id,
        unit: "BUNDLE",
        sizeId: SIZE_12.id, // differs from expectedSize 10
        quantity: 1,
        reason: "isolation-ok",
      },
      USER_ID,
    );

    expect(result.movementId).toBe(100);
  });
});

// ── Transfer ────────────────────────────────────────────────────────────────

describe("recordTransfer — destination expectedSize / one-size", () => {
  const from = generalLocation({
    id: 1,
    code: "S1",
    nameAr: "مصدر",
    expectedSizeId: null,
    expectedSize: null,
  });

  function mockLocations(to: ReturnType<typeof generalLocation>) {
    mockPrisma.stockLocation.findUnique.mockImplementation(
      async ({ where }: { where: { id: number } }) => {
        if (where.id === from.id) return from;
        if (where.id === to.id) return to;
        return null;
      },
    );
  }

  function mockHealthySourceBalances() {
    mockPrisma.stockMovement.aggregate
      // source bundles
      .mockResolvedValueOnce({ _sum: { quantity: 10 } })
      // source tons
      .mockResolvedValueOnce({ _sum: { quantity: 20 } });
  }

  it("rejects transfer into an empty bay reserved for another size", async () => {
    const to = generalLocation({
      id: 2,
      code: "D1",
      nameAr: "وجهة",
      expectedSizeId: SIZE_10.id,
      expectedSize: SIZE_10,
    });
    mockLocations(to);
    mockPrisma.stockMovement.groupBy.mockResolvedValue([]); // empty dest

    await expect(
      recordTransfer(
        {
          fromLocationId: from.id,
          toLocationId: to.id,
          sizeId: SIZE_12.id,
          quantity: 1,
          quantityTons: 1.5,
          reason: "mismatch",
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({
      messageKey: "locationSizeMustMatchExpected",
      params: { locationName: to.nameAr, sizeName: SIZE_10.displayName },
    });

    expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();
  });

  it("accepts transfer into an empty bay when size matches expectedSize", async () => {
    const to = generalLocation({
      id: 2,
      code: "D1",
      nameAr: "وجهة",
      expectedSizeId: SIZE_10.id,
      expectedSize: SIZE_10,
    });
    mockLocations(to);
    mockPrisma.stockMovement.groupBy.mockResolvedValue([]); // empty dest
    mockHealthySourceBalances();

    const result = await recordTransfer(
      {
        fromLocationId: from.id,
        toLocationId: to.id,
        sizeId: SIZE_10.id,
        quantity: 1,
        quantityTons: 1.5,
        reason: "ok",
      },
      USER_ID,
    );

    expect(result.outMovementId).toBeDefined();
    expect(result.inMovementId).toBeDefined();
    // BUNDLE out/in + TON out/in
    expect(mockPrisma.stockMovement.create).toHaveBeenCalledTimes(4);
  });

  it("rejects transfer into a bay occupied by a different size", async () => {
    const to = generalLocation({
      id: 2,
      code: "D1",
      nameAr: "وجهة",
      expectedSizeId: SIZE_12.id,
      expectedSize: SIZE_12,
    });
    mockLocations(to);
    mockPrisma.stockMovement.groupBy.mockResolvedValue([
      { sizeId: SIZE_12.id, _sum: { quantity: 3 } },
    ]);

    await expect(
      recordTransfer(
        {
          fromLocationId: from.id,
          toLocationId: to.id,
          sizeId: SIZE_10.id,
          quantity: 1,
          quantityTons: 1.2,
          reason: "occupied",
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({
      messageKey: "destLocationHasOtherSizeEmptyFirst",
      params: { locationName: to.nameAr, sizeName: SIZE_12.displayName },
    });
  });

  it("allows transfer into ISOLATION even when expectedSize differs", async () => {
    const to = isolationLocation({ id: 2, code: "I2", nameAr: "عزل وجهة" });
    mockLocations(to);
    // No dest one-size groupBy for ISOLATION — only aggregates for source
    mockHealthySourceBalances();

    const result = await recordTransfer(
      {
        fromLocationId: from.id,
        toLocationId: to.id,
        sizeId: SIZE_12.id,
        quantity: 1,
        quantityTons: 1.1,
        reason: "isolation",
      },
      USER_ID,
    );

    expect(result.outMovementId).toBeDefined();
    expect(mockPrisma.stockMovement.groupBy).not.toHaveBeenCalled();
  });
});

// ── Adjustment ──────────────────────────────────────────────────────────────

describe("recordAdjustment — expectedSize on empty bay", () => {
  it("rejects introducing a new positive line that mismatches expectedSize", async () => {
    const loc = generalLocation({ expectedSize: undefined });
    mockPrisma.stockLocation.findUnique.mockResolvedValue(loc);
    // Current balance for (loc, size 12, BUNDLE) is 0
    mockPrisma.stockMovement.aggregate.mockResolvedValue({
      _sum: { quantity: 0 },
    });
    // Empty of positive bundles
    mockPrisma.stockMovement.groupBy.mockResolvedValue([]);

    await expect(
      recordAdjustment(
        {
          locationId: loc.id,
          unit: "BUNDLE",
          sizeId: SIZE_12.id,
          actualQuantity: 3,
          reason: "count-wrong-size",
        },
        USER_ID,
      ),
    ).rejects.toMatchObject({
      messageKey: "locationSizeMustMatchExpected",
      params: { locationName: loc.nameAr, sizeName: SIZE_10.displayName },
    });
  });

  it("still allows counting down a legacy wrong-size line that is already positive", async () => {
    const loc = generalLocation({ expectedSize: undefined });
    mockPrisma.stockLocation.findUnique.mockResolvedValue(loc);
    // Already holds 5 of size 12 — correction down to 2 (delta negative)
    mockPrisma.stockMovement.aggregate.mockResolvedValue({
      _sum: { quantity: 5 },
    });

    const result = await recordAdjustment(
      {
        locationId: loc.id,
        unit: "BUNDLE",
        sizeId: SIZE_12.id,
        actualQuantity: 2,
        reason: "drain-legacy",
      },
      USER_ID,
    );

    expect(result.delta).toBe(-3);
    expect(result.movementId).toBe(100);
    // one-size branch only runs when current ≤ 0
    expect(mockPrisma.stockMovement.groupBy).not.toHaveBeenCalled();
  });
});
