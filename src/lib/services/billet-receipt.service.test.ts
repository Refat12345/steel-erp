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
      expect.objectContaining({ where: {} }),
    );
    expect(mockPrisma.billetReceipt.count).toHaveBeenCalledWith({ where: {} });
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
