import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  customer: { findUnique: vi.fn() },
  truckOperation: { findMany: vi.fn() },
  billetReceipt: { findMany: vi.fn() },
  supplierContract: { findUnique: vi.fn(), findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
// Analytics-start clamp: passthrough by default (no start date configured).
// Individual tests override to exercise the clamped path.
const mockClampEventWindow = vi.hoisted(() =>
  vi.fn(async (from?: Date, to?: Date) => ({
    from,
    to,
    clamped: false,
    analyticsStartDate: null as string | null,
  })),
);
vi.mock("./settings.service", () => ({
  clampEventWindow: mockClampEventWindow,
  getAnalyticsStartDateValue: vi.fn(async () => null),
}));

import {
  getDailyTrucksReport,
  getDailyLoadingSummary,
  getCustomerWithdrawalsReport,
  getDailyBilletReport,
} from "./report.service";
import { ServiceError } from "./errors";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getDailyTrucksReport", () => {
  it("filters trucks by operational window and customer", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: 5,
      fullName: "زبون تجريبي",
    });
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);

    await getDailyTrucksReport({
      operationalDate: "2026-05-23",
      customerId: 5,
    });

    expect(mockPrisma.truckOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId: 5,
          createdAt: {
            gte: new Date(2026, 4, 23, 8, 0, 0, 0),
            lt: new Date(2026, 4, 24, 8, 0, 0, 0),
          },
        }),
      }),
    );
  });

  it("clamps the window to the analytics start and flags the report", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    // Requested day 2026-05-23 lies before the configured start 2026-06-01.
    const analyticsStart = new Date(2026, 5, 1, 8, 0, 0, 0);
    mockClampEventWindow.mockResolvedValueOnce({
      from: analyticsStart,
      to: new Date(2026, 4, 24, 8, 0, 0, 0),
      clamped: true,
      analyticsStartDate: "2026-06-01",
    });

    const report = await getDailyTrucksReport({ operationalDate: "2026-05-23" });

    // Fully-excluded window collapses to an empty range capped at window.to.
    expect(mockPrisma.truckOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date(2026, 4, 24, 8, 0, 0, 0),
            lt: new Date(2026, 4, 24, 8, 0, 0, 0),
          },
        }),
      }),
    );
    expect(report.windowClamped).toBe(true);
    expect(report.analyticsStartDate).toBe("2026-06-01");
    expect(report.rows).toHaveLength(0);
  });

  it("sums tonnage only for included completed trucks", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([
      {
        id: 1,
        plateNumber: "A-1",
        driverName: "سائق",
        salesOrderNumber: "SO-1",
        status: "Completed",
        tareWeightKg: 10_000,
        grossWeightKg: 25_000,
        createdAt: new Date(2026, 4, 23, 10, 0, 0, 0),
        closedAt: new Date(2026, 4, 23, 16, 0, 0, 0),
        loadingConfirmedAt: new Date(2026, 4, 23, 13, 30, 0, 0),
        lastReopenedAt: null,
        cancelReason: null,
        operationalGrade: null,
        salesOrder: null,
        customer: { id: 1, fullName: "ز", code: "C-1" },
        destination: null,
        rounds: [],
        sessions: [
          {
            sizeId: 8,
            bundleCount: 20,
            weightTons: 10.5,
            createdAt: new Date(2026, 4, 23, 12, 0, 0, 0),
            size: { displayName: "8 مم", sortOrder: 8 },
          },
          {
            sizeId: 12,
            bundleCount: 8,
            weightTons: 4.3,
            createdAt: new Date(2026, 4, 23, 12, 30, 0, 0),
            size: { displayName: "12 مم", sortOrder: 12 },
          },
        ],
      },
      {
        id: 2,
        plateNumber: "B-2",
        driverName: "سائق",
        salesOrderNumber: null,
        status: "Completed",
        tareWeightKg: 10_000,
        grossWeightKg: 30_000,
        createdAt: new Date(2026, 4, 23, 11, 0, 0, 0),
        closedAt: new Date(2026, 4, 24, 9, 0, 0, 0),
        loadingConfirmedAt: null,
        lastReopenedAt: null,
        cancelReason: null,
        operationalGrade: null,
        salesOrder: null,
        customer: null,
        destination: null,
        rounds: [],
        sessions: [
          {
            sizeId: 8,
            bundleCount: 40,
            weightTons: 20,
            createdAt: new Date(2026, 4, 23, 14, 0, 0, 0),
            size: { displayName: "8 مم", sortOrder: 8 },
          },
        ],
      },
      {
        id: 3,
        plateNumber: "C-3",
        driverName: "سائق",
        salesOrderNumber: null,
        status: "Cancelled",
        tareWeightKg: null,
        grossWeightKg: null,
        createdAt: new Date(2026, 4, 23, 12, 0, 0, 0),
        closedAt: new Date(2026, 4, 24, 8, 30, 0, 0),
        loadingConfirmedAt: null,
        lastReopenedAt: null,
        cancelReason: "تجاوزت اليوم",
        operationalGrade: null,
        salesOrder: null,
        customer: null,
        destination: null,
        rounds: [],
        sessions: [],
      },
    ]);

    const report = await getDailyTrucksReport({
      operationalDate: "2026-05-23",
      canViewSensitiveTonnage: true,
    });

    expect(report.summary.registered).toBe(3);
    expect(report.summary.completed).toBe(2);
    expect(report.summary.cancelled).toBe(1);
    expect(report.summary.totalBridgeTons).toBe(15);
    expect(report.summary.totalInternalTons).toBe(14.8);
    expect(report.summary.totalDiscrepancyTons).toBe(0.2);
    expect(report.rows[0].internalLoadingMs).toBe(90 * 60 * 1000);
    expect(report.rows[0].tonnageStatus).toBe("included");
    expect(report.rows[1].tonnageStatus).toBe("excluded_late_close");
    expect(report.rows[1].bridgeTons).toBeNull();
    expect(report.rows[2].noteAr).toBe("تجاوزت اليوم");
    expect(report.sizeTotals).toEqual([
      {
        sizeId: 8,
        displayName: "8 مم",
        totalTons: 10.5,
        totalBundles: 20,
        truckCount: 1,
      },
      {
        sizeId: 12,
        displayName: "12 مم",
        totalTons: 4.3,
        totalBundles: 8,
        truckCount: 1,
      },
    ]);
  });

  it("reports the round grade for completed trucks, overriding sales-order/operational grade", async () => {
    // Round physically loaded SECOND, but the sales order says FIRST and the
    // operation-level grade is stale FIRST. After an admin grade correction the
    // authoritative source is the round, so the report must show SECOND.
    mockPrisma.truckOperation.findMany.mockResolvedValue([
      {
        id: 70,
        plateNumber: "R-1",
        driverName: "سائق",
        salesOrderNumber: "SO-FIRST",
        status: "Completed",
        tareWeightKg: 13_200,
        grossWeightKg: 30_000,
        createdAt: new Date(2026, 4, 23, 10, 0, 0, 0),
        closedAt: new Date(2026, 4, 23, 12, 0, 0, 0),
        loadingConfirmedAt: new Date(2026, 4, 23, 11, 0, 0, 0),
        lastReopenedAt: null,
        cancelReason: null,
        operationalGrade: "FIRST",
        salesOrder: { grade: "FIRST" },
        customer: null,
        destination: null,
        rounds: [
          { id: 1, roundNumber: 1, grade: "SECOND", startWeightKg: 13_200, endWeightKg: 30_000 },
        ],
        sessions: [
          {
            bridgeRoundId: 1,
            sizeId: 8,
            bundleCount: 10,
            weightTons: 16.8,
            createdAt: new Date(2026, 4, 23, 11, 0, 0, 0),
            size: { displayName: "8 مم", sortOrder: 8, code: "8" },
          },
        ],
      },
    ]);

    const report = await getDailyTrucksReport({
      operationalDate: "2026-05-23",
      canViewSensitiveTonnage: true,
    });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].grade).toBe("SECOND");
    expect(report.rows[0].gradeLabelAr).toBe("نخب ثاني");
  });

  it("filters by effective grade from sales order or operational grade", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([
      {
        id: 11,
        plateNumber: "G-1",
        driverName: "سائق",
        salesOrderNumber: "SO-FIRST",
        status: "Completed",
        tareWeightKg: 10_000,
        grossWeightKg: 22_000,
        createdAt: new Date(2026, 4, 23, 10, 0, 0, 0),
        closedAt: new Date(2026, 4, 23, 12, 0, 0, 0),
        cancelReason: null,
        operationalGrade: "SECOND",
        salesOrder: { grade: "FIRST" },
        customer: null,
        destination: null,
        rounds: [],
        sessions: [
          {
            sizeId: 8,
            bundleCount: 10,
            weightTons: 12,
            createdAt: new Date(2026, 4, 23, 11, 0, 0, 0),
            size: { displayName: "8 مم", sortOrder: 8 },
          },
        ],
      },
      {
        id: 12,
        plateNumber: "G-2",
        driverName: "سائق",
        salesOrderNumber: null,
        status: "Completed",
        tareWeightKg: 10_000,
        grossWeightKg: 28_000,
        createdAt: new Date(2026, 4, 23, 11, 0, 0, 0),
        closedAt: new Date(2026, 4, 23, 13, 0, 0, 0),
        cancelReason: null,
        operationalGrade: "SECOND",
        salesOrder: null,
        customer: null,
        destination: null,
        rounds: [],
        sessions: [
          {
            sizeId: 12,
            bundleCount: 18,
            weightTons: 18,
            createdAt: new Date(2026, 4, 23, 12, 0, 0, 0),
            size: { displayName: "12 مم", sortOrder: 12 },
          },
        ],
      },
    ]);

    const report = await getDailyTrucksReport({
      operationalDate: "2026-05-23",
      productFilter: "FIRST",
      canViewSensitiveTonnage: true,
    });

    expect(report.filters.productFilter).toBe("FIRST");
    expect(report.filters.productFilterLabelAr).toBe("نخب أول");
    expect(report.summary.registered).toBe(1);
    expect(report.summary.totalInternalTons).toBe(12);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].grade).toBe("FIRST");
    expect(report.rows[0].gradeLabelAr).toBe("نخب أول");
    expect(report.sizeTotals).toEqual([
      {
        sizeId: 8,
        displayName: "8 مم",
        totalTons: 12,
        totalBundles: 10,
        truckCount: 1,
      },
    ]);
  });

  it("includes mixed multi-round trucks with grade-filtered bridge tons", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([
      {
        id: 50,
        plateNumber: "MIX-1",
        driverName: "سائق",
        salesOrderNumber: null,
        status: "Completed",
        tareWeightKg: 10_000,
        grossWeightKg: 30_000,
        createdAt: new Date(2026, 4, 23, 10, 0, 0, 0),
        closedAt: new Date(2026, 4, 23, 14, 0, 0, 0),
        loadingConfirmedAt: null,
        lastReopenedAt: null,
        cancelReason: null,
        operationalGrade: "FIRST",
        salesOrder: null,
        customer: null,
        destination: null,
        rounds: [
          {
            id: 1,
            roundNumber: 1,
            grade: "FIRST",
            startWeightKg: 10_000,
            endWeightKg: 25_000,
          },
          {
            id: 2,
            roundNumber: 2,
            grade: "SECOND",
            startWeightKg: 25_000,
            endWeightKg: 30_000,
          },
        ],
        sessions: [
          {
            bridgeRoundId: 1,
            sizeId: 8,
            bundleCount: 10,
            weightTons: 12,
            createdAt: new Date(2026, 4, 23, 11, 0, 0, 0),
            size: { displayName: "8 مم", sortOrder: 8 },
          },
          {
            bridgeRoundId: 2,
            sizeId: 12,
            bundleCount: 4,
            weightTons: 5,
            createdAt: new Date(2026, 4, 23, 12, 0, 0, 0),
            size: { displayName: "12 مم", sortOrder: 12 },
          },
        ],
      },
      {
        id: 51,
        plateNumber: "PURE-1",
        driverName: "سائق",
        salesOrderNumber: null,
        status: "Completed",
        tareWeightKg: 10_000,
        grossWeightKg: 25_000,
        createdAt: new Date(2026, 4, 23, 11, 0, 0, 0),
        closedAt: new Date(2026, 4, 23, 13, 0, 0, 0),
        loadingConfirmedAt: null,
        lastReopenedAt: null,
        cancelReason: null,
        operationalGrade: "FIRST",
        salesOrder: null,
        customer: null,
        destination: null,
        rounds: [
          {
            id: 3,
            roundNumber: 1,
            grade: "FIRST",
            startWeightKg: 10_000,
            endWeightKg: 25_000,
          },
        ],
        sessions: [
          {
            bridgeRoundId: 3,
            sizeId: 8,
            bundleCount: 10,
            weightTons: 15,
            createdAt: new Date(2026, 4, 23, 12, 0, 0, 0),
            size: { displayName: "8 مم", sortOrder: 8 },
          },
        ],
      },
    ]);

    const firstReport = await getDailyTrucksReport({
      operationalDate: "2026-05-23",
      productFilter: "FIRST",
      canViewSensitiveTonnage: true,
    });

    expect(firstReport.rows).toHaveLength(2);
    const mixed = firstReport.rows.find((r) => r.id === 50);
    expect(mixed?.bridgeTons).toBe(15);
    expect(mixed?.internalTons).toBe(12);
    expect(mixed?.isPartialVisit).toBe(true);
    expect(firstReport.summary.totalBridgeTons).toBe(30);

    const secondReport = await getDailyTrucksReport({
      operationalDate: "2026-05-23",
      productFilter: "SECOND",
      canViewSensitiveTonnage: true,
    });

    expect(secondReport.rows).toHaveLength(1);
    expect(secondReport.rows[0]?.id).toBe(50);
    expect(secondReport.rows[0]?.bridgeTons).toBe(5);
    expect(secondReport.rows[0]?.internalTons).toBe(5);

    const allReport = await getDailyTrucksReport({
      operationalDate: "2026-05-23",
      canViewSensitiveTonnage: true,
    });

    expect(allReport.rows).toHaveLength(2);
    expect(allReport.summary.totalBridgeTons).toBe(35);
  });

  it("includes bridge-only totals when internal sessions are missing", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([
      {
        id: 10,
        plateNumber: "X-1",
        driverName: "سائق",
        salesOrderNumber: null,
        status: "Completed",
        tareWeightKg: 10_000,
        grossWeightKg: 22_000,
        createdAt: new Date(2026, 4, 23, 10, 0, 0, 0),
        closedAt: new Date(2026, 4, 23, 12, 0, 0, 0),
        loadingConfirmedAt: null,
        lastReopenedAt: null,
        cancelReason: null,
        operationalGrade: null,
        salesOrder: null,
        customer: null,
        destination: null,
        rounds: [],
        sessions: [],
      },
    ]);

    const report = await getDailyTrucksReport({
      operationalDate: "2026-05-23",
      canViewSensitiveTonnage: true,
    });

    expect(report.summary.totalBridgeTons).toBe(12);
    expect(report.summary.totalInternalTons).toBe(0);
    expect(report.rows[0].bridgeTons).toBe(12);
    expect(report.rows[0].internalTons).toBeNull();
  });

  it("exposes a per-round breakdown only for multi-round included trucks", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([
      {
        id: 30,
        plateNumber: "M-1",
        driverName: "سائق",
        salesOrderNumber: null,
        status: "Completed",
        tareWeightKg: 10_000,
        grossWeightKg: 30_000,
        createdAt: new Date(2026, 4, 23, 10, 0, 0, 0),
        closedAt: new Date(2026, 4, 23, 14, 0, 0, 0),
        loadingConfirmedAt: null,
        lastReopenedAt: null,
        cancelReason: null,
        operationalGrade: null,
        salesOrder: null,
        customer: null,
        destination: null,
        rounds: [
          { roundNumber: 1, grade: "FIRST", startWeightKg: 10_000, endWeightKg: 25_000 },
          { roundNumber: 2, grade: "SECOND", startWeightKg: 25_000, endWeightKg: 30_000 },
        ],
        sessions: [],
      },
    ]);

    const report = await getDailyTrucksReport({
      operationalDate: "2026-05-23",
      canViewSensitiveTonnage: true,
    });

    expect(report.rows[0].rounds).toEqual([
      { roundNumber: 1, grade: "FIRST", gradeLabelAr: "نخب أول", netTons: 15 },
      { roundNumber: 2, grade: "SECOND", gradeLabelAr: "نخب ثاني", netTons: 5 },
    ]);
    // The whole-visit bridge net is unchanged by the round split.
    expect(report.rows[0].bridgeTons).toBe(20);
  });

  it("redacts row and summary sensitive tonnage without hiding size totals", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([
      {
        id: 20,
        plateNumber: "R-1",
        driverName: "سائق",
        salesOrderNumber: null,
        status: "Completed",
        tareWeightKg: 10_000,
        grossWeightKg: 25_000,
        createdAt: new Date(2026, 4, 23, 10, 0, 0, 0),
        closedAt: new Date(2026, 4, 23, 13, 0, 0, 0),
        loadingConfirmedAt: new Date(2026, 4, 23, 12, 0, 0, 0),
        lastReopenedAt: null,
        cancelReason: null,
        operationalGrade: null,
        salesOrder: null,
        customer: null,
        destination: null,
        rounds: [],
        sessions: [
          {
            sizeId: 8,
            bundleCount: 20,
            weightTons: 14.5,
            createdAt: new Date(2026, 4, 23, 11, 0, 0, 0),
            size: { displayName: "8 مم", sortOrder: 8 },
          },
        ],
      },
    ]);

    const report = await getDailyTrucksReport({ operationalDate: "2026-05-23" });

    expect(report.permissions.canViewSensitiveTonnage).toBe(false);
    expect(report.summary.totalBridgeTons).toBe(15);
    expect(report.summary.totalInternalTons).toBeNull();
    expect(report.summary.totalDiscrepancyTons).toBeNull();
    expect(report.sizeTotals).toEqual([
      {
        sizeId: 8,
        displayName: "8 مم",
        totalTons: 14.5,
        totalBundles: 20,
        truckCount: 1,
      },
    ]);
    expect(report.rows[0].bridgeTons).toBe(15);
    expect(report.rows[0].internalTons).toBeNull();
    expect(report.rows[0].discrepancyTons).toBeNull();
    expect(report.rows[0].discrepancyWarning).toBe(false);
    expect(report.rows[0].internalLoadingMs).toBe(60 * 60 * 1000);
  });

  it("throws when customer filter is unknown", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);

    await expect(
      getDailyTrucksReport({ operationalDate: "2026-05-23", customerId: 99 }),
    ).rejects.toThrow(ServiceError);
  });
});

describe("getDailyLoadingSummary", () => {
  it("includes mixed FIRST + shortbar with FIRST-round tons only", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([
      {
        id: 50,
        status: "Completed",
        tareWeightKg: 10_000,
        grossWeightKg: 28_000,
        closedAt: new Date(2026, 4, 23, 14, 0, 0, 0),
        operationalGrade: "FIRST",
        customer: { id: 1, fullName: "زبون" },
        destination: { id: 2, name: "دمشق" },
        salesOrder: null,
        rounds: [
          { id: 1, grade: "FIRST", startWeightKg: 10_000, endWeightKg: 25_000 },
          { id: 2, grade: null, startWeightKg: 25_000, endWeightKg: 28_000 },
        ],
        sessions: [
          {
            bridgeRoundId: 1,
            sizeId: 8,
            weightTons: 12,
            size: { code: "8", displayName: "8 مم", sortOrder: 8 },
          },
          {
            bridgeRoundId: 2,
            sizeId: 99,
            weightTons: 2,
            size: { code: "shortbar_1_4m", displayName: "قصائر", sortOrder: 99 },
          },
        ],
      },
      {
        id: 51,
        status: "Completed",
        tareWeightKg: 10_000,
        grossWeightKg: 25_000,
        closedAt: new Date(2026, 4, 23, 13, 0, 0, 0),
        operationalGrade: "FIRST",
        customer: { id: 1, fullName: "زبون" },
        destination: { id: 2, name: "دمشق" },
        salesOrder: null,
        rounds: [{ id: 3, grade: "FIRST", startWeightKg: 10_000, endWeightKg: 25_000 }],
        sessions: [
          {
            bridgeRoundId: 3,
            sizeId: 8,
            weightTons: 15,
            size: { code: "8", displayName: "8 مم", sortOrder: 8 },
          },
        ],
      },
    ]);

    const report = await getDailyLoadingSummary({
      operationalDate: "2026-05-23",
      productFilter: "FIRST",
    });

    expect(report.totals.truckCount).toBe(2);
    expect(report.totals.totalBridgeTons).toBe(30);
    expect(report.totals.totalInternalTons).toBe(27);
    expect(report.byCustomer).toHaveLength(1);
    expect(report.byCustomer[0]?.loads).toBe(2);

    const allReport = await getDailyLoadingSummary({
      operationalDate: "2026-05-23",
    });

    expect(allReport.totals.truckCount).toBe(2);
    expect(allReport.totals.totalBridgeTons).toBe(33);
  });

  it("clamps a monthly window straddling the analytics start and shifts the printed period start", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    // Monthly window for 2026-06-20 = [Jun 1 08:00, Jul 1 08:00); the
    // configured start 2026-06-05 cuts into it.
    const analyticsStart = new Date(2026, 5, 5, 8, 0, 0, 0);
    mockClampEventWindow.mockResolvedValueOnce({
      from: analyticsStart,
      to: new Date(2026, 6, 1, 8, 0, 0, 0),
      clamped: true,
      analyticsStartDate: "2026-06-05",
    });

    const report = await getDailyLoadingSummary({
      operationalDate: "2026-06-20",
      period: "monthly",
    });

    expect(mockPrisma.truckOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: analyticsStart,
            lt: new Date(2026, 6, 1, 8, 0, 0, 0),
          },
        }),
      }),
    );
    // The printed header must reflect the range actually queried.
    expect(report.periodStartDate).toBe("2026-06-05");
    expect(report.windowClamped).toBe(true);
    expect(report.analyticsStartDate).toBe("2026-06-05");
  });

  it("combines shortbar rounds under SHORTBAR product filter", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([
      {
        id: 60,
        status: "Completed",
        tareWeightKg: 10_000,
        grossWeightKg: 20_000,
        closedAt: new Date(2026, 4, 23, 14, 0, 0, 0),
        operationalGrade: null,
        customer: { id: 1, fullName: "زبون" },
        destination: { id: 2, name: "دمشق" },
        salesOrder: null,
        rounds: [
          { id: 10, grade: null, startWeightKg: 10_000, endWeightKg: 15_000 },
          { id: 11, grade: null, startWeightKg: 15_000, endWeightKg: 20_000 },
        ],
        sessions: [
          {
            bridgeRoundId: 10,
            sizeId: 101,
            weightTons: 4,
            size: { code: "shortbar_1_4m", displayName: "قص 1-4", sortOrder: 101 },
          },
          {
            bridgeRoundId: 11,
            sizeId: 102,
            weightTons: 5,
            size: { code: "shortbar_4_12m", displayName: "قص 4-12", sortOrder: 102 },
          },
        ],
      },
    ]);

    const report = await getDailyLoadingSummary({
      operationalDate: "2026-05-23",
      productFilter: "SHORTBAR",
    });

    expect(report.filters.productFilter).toBe("SHORTBAR");
    expect(report.filters.productFilterLabelAr).toBe("قصائر");
    expect(report.totals.truckCount).toBe(1);
    expect(report.totals.totalBridgeTons).toBe(10);
    expect(report.totals.totalInternalTons).toBe(9);
  });
});

describe("getCustomerWithdrawalsReport analytics-start clamping", () => {
  beforeEach(() => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
  });

  it("raises the range floor and prints the effective from date", async () => {
    // Requested 2026-05-01 → 2026-06-10; configured start 2026-06-01.
    const analyticsStart = new Date(2026, 5, 1, 8, 0, 0, 0);
    mockClampEventWindow.mockResolvedValueOnce({
      from: analyticsStart,
      to: new Date(2026, 5, 11, 8, 0, 0, 0),
      clamped: true,
      analyticsStartDate: "2026-06-01",
    });

    const report = await getCustomerWithdrawalsReport({
      fromDate: "2026-05-01",
      toDate: "2026-06-10",
    });

    expect(mockPrisma.truckOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "Completed",
          closedAt: {
            gte: analyticsStart,
            lt: new Date(2026, 5, 11, 8, 0, 0, 0),
          },
        }),
      }),
    );
    // Header shows the range actually queried, not the requested one.
    expect(report.fromDate).toBe("2026-06-01");
    expect(report.toDate).toBe("2026-06-10");
    expect(report.windowClamped).toBe(true);
    expect(report.analyticsStartDate).toBe("2026-06-01");
  });

  it("collapses a fully pre-start range to an empty window instead of inverting", async () => {
    // Requested 2026-05-01 → 2026-05-10, entirely before the 2026-06-01 start.
    mockClampEventWindow.mockResolvedValueOnce({
      from: new Date(2026, 5, 1, 8, 0, 0, 0),
      to: new Date(2026, 4, 11, 8, 0, 0, 0),
      clamped: true,
      analyticsStartDate: "2026-06-01",
    });

    const report = await getCustomerWithdrawalsReport({
      fromDate: "2026-05-01",
      toDate: "2026-05-10",
    });

    // from is capped at to → gte === lt → zero rows, never an inverted range.
    expect(mockPrisma.truckOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          closedAt: {
            gte: new Date(2026, 4, 11, 8, 0, 0, 0),
            lt: new Date(2026, 4, 11, 8, 0, 0, 0),
          },
        }),
      }),
    );
    expect(report.rows).toHaveLength(0);
    expect(report.totals.truckCount).toBe(0);
    expect(report.windowClamped).toBe(true);
  });

  it("leaves a fully post-start range untouched", async () => {
    const report = await getCustomerWithdrawalsReport({
      fromDate: "2026-06-05",
      toDate: "2026-06-10",
    });

    expect(mockPrisma.truckOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          closedAt: {
            gte: new Date(2026, 5, 5, 8, 0, 0, 0),
            lt: new Date(2026, 5, 11, 8, 0, 0, 0),
          },
        }),
      }),
    );
    expect(report.fromDate).toBe("2026-06-05");
    expect(report.windowClamped).toBe(false);
  });
});

describe("getDailyBilletReport analytics-start clamping", () => {
  beforeEach(() => {
    mockPrisma.billetReceipt.findMany.mockResolvedValue([]);
  });

  it("collapses a fully pre-start day to an empty window and flags the report", async () => {
    // Requested day 2026-05-23 lies before the configured start 2026-06-01.
    mockClampEventWindow.mockResolvedValueOnce({
      from: new Date(2026, 5, 1, 8, 0, 0, 0),
      to: new Date(2026, 4, 24, 8, 0, 0, 0),
      clamped: true,
      analyticsStartDate: "2026-06-01",
    });

    const report = await getDailyBilletReport({ operationalDate: "2026-05-23" });

    expect(mockPrisma.billetReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date(2026, 4, 24, 8, 0, 0, 0),
            lt: new Date(2026, 4, 24, 8, 0, 0, 0),
          },
        }),
      }),
    );
    expect(report.rows).toHaveLength(0);
    expect(report.windowClamped).toBe(true);
    expect(report.analyticsStartDate).toBe("2026-06-01");
  });

  it("queries the normal operational window for a post-start day", async () => {
    const report = await getDailyBilletReport({ operationalDate: "2026-06-06" });

    expect(mockPrisma.billetReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date(2026, 5, 6, 8, 0, 0, 0),
            lt: new Date(2026, 5, 7, 8, 0, 0, 0),
          },
        }),
      }),
    );
    expect(report.windowClamped).toBe(false);
  });
});

describe("getDailyBilletReport", () => {
  beforeEach(() => {
    mockPrisma.billetReceipt.findMany.mockResolvedValue([]);
    mockPrisma.supplierContract.findUnique.mockResolvedValue(null);
    mockPrisma.supplierContract.findMany.mockResolvedValue([]);
  });

  function makeReceipt(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      receiptNumber: "R-26-0001",
      plateNumber: "1234",
      driverName: "Driver",
      status: "Completed",
      createdAt: new Date(2026, 5, 6, 10, 0, 0),
      closedAt: new Date(2026, 5, 6, 12, 0, 0),
      netWeightKg: 25000,
      declaredWeightKg: 26000,
      cancelReason: null,
      isPriorWithdrawal: false,
      isAdjustment: false,
      contract: { contractNumber: "P-26-001", supplierName: "asda" },
      pieceLines: [
        {
          billetLengthM: 12,
          countedPieces: 100,
          rejectedPieces: 5,
          expectedPieces: 100,
        },
        {
          billetLengthM: 6,
          countedPieces: 40,
          rejectedPieces: 0,
          expectedPieces: 40,
        },
      ],
      ...overrides,
    };
  }

  it("rejects an invalid operational date", async () => {
    await expect(
      getDailyBilletReport({ operationalDate: "not-a-date" }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("excludes adjustments and filters by operational day", async () => {
    await getDailyBilletReport({ operationalDate: "2026-06-06" });

    expect(mockPrisma.billetReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isAdjustment: false,
          createdAt: {
            gte: new Date(2026, 5, 6, 8, 0, 0, 0),
            lt: new Date(2026, 5, 7, 8, 0, 0, 0),
          },
        }),
      }),
    );
  });

  it("sums net tons and pieces only for receipts completed within the day", async () => {
    mockPrisma.billetReceipt.findMany.mockResolvedValue([
      makeReceipt({ id: 1 }),
      makeReceipt({
        id: 2,
        receiptNumber: "R-26-0002",
        status: "Loaded",
        closedAt: null,
        netWeightKg: null,
        pieceLines: [
          {
            billetLengthM: 12,
            countedPieces: null,
            rejectedPieces: 0,
            expectedPieces: 50,
          },
        ],
      }),
      makeReceipt({
        id: 3,
        receiptNumber: "R-26-0003",
        status: "Cancelled",
        cancelReason: "wrong plate",
        netWeightKg: 10000,
        pieceLines: [],
      }),
      makeReceipt({
        id: 4,
        receiptNumber: "R-26-0004",
        // Closed after operational day end (08:00 next day)
        closedAt: new Date(2026, 5, 7, 9, 0, 0),
        netWeightKg: 8000,
      }),
    ]);

    const report = await getDailyBilletReport({ operationalDate: "2026-06-06" });

    expect(report.summary.registered).toBe(4);
    expect(report.summary.completed).toBe(2);
    expect(report.summary.cancelled).toBe(1);
    expect(report.summary.open).toBe(1);
    expect(report.summary.includedLoads).toBe(1);
    expect(report.summary.totalNetTons).toBe(25);
    // accepted = (100-5) + 40 = 135
    expect(report.summary.totalAcceptedPieces).toBe(135);
    expect(report.summary.totalRemainingTons).toBe(0);

    expect(report.bySupplier).toEqual([
      expect.objectContaining({
        supplierName: "asda",
        loads: 1,
        tons: 25,
        sharePct: 100,
        remainingTons: 0,
      }),
    ]);
    expect(report.byContract).toEqual([
      expect.objectContaining({
        contractNumber: "P-26-001",
        tons: 25,
        remainingTons: 0,
      }),
    ]);
    expect(report.lengthTotals).toEqual([
      expect.objectContaining({
        billetLengthM: 6,
        acceptedPieces: 40,
        receiptCount: 1,
      }),
      expect.objectContaining({
        billetLengthM: 12,
        acceptedPieces: 95,
        receiptCount: 1,
      }),
    ]);

    const included = report.rows.find((r) => r.id === 1);
    const open = report.rows.find((r) => r.id === 2);
    const cancelled = report.rows.find((r) => r.id === 3);
    const late = report.rows.find((r) => r.id === 4);
    expect(included?.tonnageStatus).toBe("included");
    expect(included?.netTons).toBe(25);
    expect(open?.tonnageStatus).toBe("excluded_open");
    expect(open?.netTons).toBeNull();
    expect(cancelled?.tonnageStatus).toBe("excluded_cancelled");
    expect(cancelled?.note).toBe("wrong plate");
    expect(late?.tonnageStatus).toBe("excluded_late_close");
    expect(late?.netTons).toBeNull();

    // No supplier/contract filter → no balance lookups
    expect(mockPrisma.supplierContract.findMany).not.toHaveBeenCalled();
  });

  it("filters by supplier name", async () => {
    await getDailyBilletReport({
      operationalDate: "2026-06-06",
      supplierName: "asda",
    });

    expect(mockPrisma.billetReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contract: {
            supplierName: { equals: "asda", mode: "insensitive" },
          },
        }),
      }),
    );
  });

  it("filters by contract and rejects supplier mismatch", async () => {
    mockPrisma.supplierContract.findUnique.mockResolvedValue({
      contractNumber: "P-26-001",
      supplierName: "asda",
    });

    await expect(
      getDailyBilletReport({
        operationalDate: "2026-06-06",
        supplierName: "other",
        contractNumber: "P-26-001",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws NOT_FOUND for a missing contract filter", async () => {
    mockPrisma.supplierContract.findUnique.mockResolvedValue(null);

    await expect(
      getDailyBilletReport({
        operationalDate: "2026-06-06",
        contractNumber: "P-26-999",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("loads remaining for all supplier contracts when supplier is selected", async () => {
    mockPrisma.billetReceipt.findMany
      .mockResolvedValueOnce([makeReceipt()]) // day receipts
      .mockResolvedValueOnce([
        // cumulative completed for balance
        {
          supplierContractNumber: "P-26-001",
          netWeightKg: 25000,
        },
        {
          supplierContractNumber: "P-26-002",
          netWeightKg: 10000,
        },
      ]);
    mockPrisma.supplierContract.findMany
      .mockResolvedValueOnce([
        // seed all contracts for supplier
        { contractNumber: "P-26-001", supplierName: "asda" },
        { contractNumber: "P-26-002", supplierName: "asda" },
      ])
      .mockResolvedValueOnce([
        // balance contracted weights
        { contractNumber: "P-26-001", contractedWeightKg: 100000 },
        { contractNumber: "P-26-002", contractedWeightKg: 50000 },
      ]);

    const report = await getDailyBilletReport({
      operationalDate: "2026-06-06",
      supplierName: "asda",
    });

    expect(report.filters.supplierName).toBe("asda");
    expect(report.byContract).toHaveLength(2);

    const c1 = report.byContract.find((c) => c.contractNumber === "P-26-001");
    const c2 = report.byContract.find((c) => c.contractNumber === "P-26-002");
    expect(c1).toMatchObject({
      loads: 1,
      tons: 25,
      contractedTons: 100,
      receivedToDateTons: 25,
      remainingTons: 75,
    });
    expect(c2).toMatchObject({
      loads: 0,
      tons: 0,
      contractedTons: 50,
      receivedToDateTons: 10,
      remainingTons: 40,
    });
    expect(report.bySupplier[0]).toMatchObject({
      supplierName: "asda",
      tons: 25,
      remainingTons: 115,
      contractedTons: 150,
      receivedToDateTons: 35,
    });
    expect(report.summary.totalRemainingTons).toBe(115);
  });

  it("loads remaining only for the selected contract", async () => {
    mockPrisma.supplierContract.findUnique.mockResolvedValue({
      contractNumber: "P-26-001",
      supplierName: "asda",
    });
    mockPrisma.billetReceipt.findMany
      .mockResolvedValueOnce([makeReceipt()])
      .mockResolvedValueOnce([
        { supplierContractNumber: "P-26-001", netWeightKg: 40000 },
      ]);
    mockPrisma.supplierContract.findMany.mockResolvedValueOnce([
      { contractNumber: "P-26-001", contractedWeightKg: 100000 },
    ]);

    const report = await getDailyBilletReport({
      operationalDate: "2026-06-06",
      contractNumber: "P-26-001",
    });

    expect(report.filters.contractNumber).toBe("P-26-001");
    expect(report.byContract).toHaveLength(1);
    expect(report.byContract[0]).toMatchObject({
      contractNumber: "P-26-001",
      tons: 25,
      contractedTons: 100,
      receivedToDateTons: 40,
      remainingTons: 60,
    });
    expect(report.summary.totalRemainingTons).toBe(60);
    // Should not seed all supplier contracts when a specific contract is set
    expect(mockPrisma.supplierContract.findMany).toHaveBeenCalledTimes(1);
  });

  it("still shows remaining for a filtered contract with no loads today", async () => {
    mockPrisma.supplierContract.findUnique.mockResolvedValue({
      contractNumber: "P-26-001",
      supplierName: "asda",
    });
    mockPrisma.billetReceipt.findMany
      .mockResolvedValueOnce([]) // no day receipts
      .mockResolvedValueOnce([
        { supplierContractNumber: "P-26-001", netWeightKg: 20000 },
      ]);
    mockPrisma.supplierContract.findMany.mockResolvedValueOnce([
      { contractNumber: "P-26-001", contractedWeightKg: 80000 },
    ]);

    const report = await getDailyBilletReport({
      operationalDate: "2026-06-06",
      contractNumber: "P-26-001",
    });

    expect(report.summary.includedLoads).toBe(0);
    expect(report.summary.totalNetTons).toBe(0);
    expect(report.byContract).toEqual([
      expect.objectContaining({
        contractNumber: "P-26-001",
        loads: 0,
        tons: 0,
        contractedTons: 80,
        receivedToDateTons: 20,
        remainingTons: 60,
      }),
    ]);
    expect(report.summary.totalRemainingTons).toBe(60);
  });
});
