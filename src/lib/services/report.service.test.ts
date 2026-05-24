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
        cancelReason: null,
        customer: { id: 1, fullName: "ز", code: "C-1" },
        destination: null,
        sessions: [{ weightTons: 14.8 }],
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
        cancelReason: null,
        customer: null,
        destination: null,
        sessions: [{ weightTons: 20 }],
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
        cancelReason: "تجاوزت اليوم",
        customer: null,
        destination: null,
        sessions: [],
      },
    ]);

    const report = await getDailyTrucksReport({ operationalDate: "2026-05-23" });

    expect(report.summary.registered).toBe(3);
    expect(report.summary.completed).toBe(2);
    expect(report.summary.cancelled).toBe(1);
    expect(report.summary.totalBridgeTons).toBe(15);
    expect(report.summary.totalInternalTons).toBe(14.8);
    expect(report.rows[0].tonnageStatus).toBe("included");
    expect(report.rows[1].tonnageStatus).toBe("excluded_late_close");
    expect(report.rows[1].bridgeTons).toBeNull();
    expect(report.rows[2].noteAr).toBe("تجاوزت اليوم");
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
        cancelReason: null,
        customer: null,
        destination: null,
        sessions: [],
      },
    ]);

    const report = await getDailyTrucksReport({ operationalDate: "2026-05-23" });

    expect(report.summary.totalBridgeTons).toBe(12);
    expect(report.summary.totalInternalTons).toBe(0);
    expect(report.rows[0].bridgeTons).toBe(12);
    expect(report.rows[0].internalTons).toBeNull();
  });

  it("throws when customer filter is unknown", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);

    await expect(
      getDailyTrucksReport({ operationalDate: "2026-05-23", customerId: 99 }),
    ).rejects.toThrow(ServiceError);
  });
});
