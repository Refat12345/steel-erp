import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  customer: { findUnique: vi.fn() },
  truckOperation: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { getDailyTrucksReport } from "./report.service";
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
      grade: "FIRST",
      canViewSensitiveTonnage: true,
    });

    expect(report.filters.grade).toBe("FIRST");
    expect(report.filters.gradeLabelAr).toBe("نخب أول");
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
