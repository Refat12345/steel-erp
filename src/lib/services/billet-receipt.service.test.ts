/**
 * Billet-receipt listing tests.
 *
 * Focuses on the operational-day window filter applied to `listReceipts`:
 * the 08:00→08:00 (Asia/Damascus) window is matched against `createdAt`,
 * mirroring the truck-loading queue. Uses a fully mocked Prisma client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  billetReceipt: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./tx-retry", () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
}));
// Analytics-start clamp: passthrough by default (no start date configured).
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

import { listReceipts } from "./billet-receipt.service";
import { getOperationalDayWindow } from "@/lib/operational-day";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.billetReceipt.findMany.mockResolvedValue([]);
  mockPrisma.billetReceipt.count.mockResolvedValue(0);
});

describe("listReceipts", () => {
  it("filters createdAt by an operational-day half-open window", async () => {
    const window = getOperationalDayWindow("2026-06-06");

    await listReceipts(
      { dateFrom: window.from, dateTo: window.to },
      { page: 1, pageSize: 25 },
    );

    const expectedWhere = {
      isAdjustment: false,
      createdAt: {
        gte: new Date(2026, 5, 6, 8, 0, 0, 0),
        lt: new Date(2026, 5, 7, 8, 0, 0, 0),
      },
    };

    expect(mockPrisma.billetReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(mockPrisma.billetReceipt.count).toHaveBeenCalledWith({
      where: expectedWhere,
    });
  });

  it("omits the createdAt filter when no window is provided", async () => {
    await listReceipts({}, { page: 1, pageSize: 25 });

    expect(mockPrisma.billetReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isAdjustment: false } }),
    );
    expect(mockPrisma.billetReceipt.count).toHaveBeenCalledWith({
      where: { isAdjustment: false },
    });
  });

  it("floors createdAt at the analytics start when no date filter is sent", async () => {
    const analyticsStart = new Date(2026, 5, 1, 8, 0, 0, 0);
    mockClampEventWindow.mockResolvedValueOnce({
      from: analyticsStart,
      to: undefined,
      clamped: false,
      analyticsStartDate: "2026-06-01",
    });

    await listReceipts({}, { page: 1, pageSize: 25 });

    expect(mockClampEventWindow).toHaveBeenCalledWith(undefined, undefined);
    expect(mockPrisma.billetReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isAdjustment: false, createdAt: { gte: analyticsStart } },
      }),
    );
    expect(mockPrisma.billetReceipt.count).toHaveBeenCalledWith({
      where: { isAdjustment: false, createdAt: { gte: analyticsStart } },
    });
  });

  it("raises an explicit dateFrom that reaches before the analytics start", async () => {
    const requestedFrom = new Date(2026, 0, 1, 8, 0, 0, 0);
    const requestedTo = new Date(2026, 6, 1, 8, 0, 0, 0);
    const analyticsStart = new Date(2026, 5, 1, 8, 0, 0, 0);
    mockClampEventWindow.mockResolvedValueOnce({
      from: analyticsStart,
      to: requestedTo,
      clamped: true,
      analyticsStartDate: "2026-06-01",
    });

    await listReceipts(
      { dateFrom: requestedFrom, dateTo: requestedTo },
      { page: 1, pageSize: 25 },
    );

    expect(mockClampEventWindow).toHaveBeenCalledWith(requestedFrom, requestedTo);
    expect(mockPrisma.billetReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isAdjustment: false,
          createdAt: { gte: analyticsStart, lt: requestedTo },
        },
      }),
    );
  });

  it("combines the operational window with status and plate filters", async () => {
    const window = getOperationalDayWindow("2026-06-06");

    await listReceipts(
      {
        status: "Registered",
        plateNumber: "123",
        dateFrom: window.from,
        dateTo: window.to,
      },
      { page: 1, pageSize: 25 },
    );

    expect(mockPrisma.billetReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isAdjustment: false,
          status: "Registered",
          plateNumber: { contains: "123", mode: "insensitive" },
          createdAt: {
            gte: new Date(2026, 5, 6, 8, 0, 0, 0),
            lt: new Date(2026, 5, 7, 8, 0, 0, 0),
          },
        },
      }),
    );
  });
});
