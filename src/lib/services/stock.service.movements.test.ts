/**
 * Stock movement ledger tests — analytics-start clamping.
 *
 * The movements screen sends NO date filter, so without the injected
 * floor the entire pre-start history would leak into the list. These
 * tests pin the clamp wiring in `listMovements`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  stockMovement: {
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

import { listMovements } from "./stock.service";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.stockMovement.findMany.mockResolvedValue([]);
  mockPrisma.stockMovement.count.mockResolvedValue(0);
});

describe("listMovements analytics-start clamping", () => {
  it("omits the createdAt filter when no window and no start date exist", async () => {
    await listMovements({}, { page: 1, pageSize: 25 });

    expect(mockPrisma.stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it("floors createdAt at the analytics start when the UI sends no filter", async () => {
    const analyticsStart = new Date(2026, 5, 1, 8, 0, 0, 0);
    mockClampEventWindow.mockResolvedValueOnce({
      from: analyticsStart,
      to: undefined,
      clamped: false,
      analyticsStartDate: "2026-06-01",
    });

    await listMovements({}, { page: 1, pageSize: 25 });

    expect(mockClampEventWindow).toHaveBeenCalledWith(undefined, undefined);
    expect(mockPrisma.stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: analyticsStart } },
      }),
    );
    expect(mockPrisma.stockMovement.count).toHaveBeenCalledWith({
      where: { createdAt: { gte: analyticsStart } },
    });
  });

  it("raises an explicit from that reaches before the analytics start", async () => {
    const requestedTo = new Date(2026, 6, 1, 8, 0, 0, 0);
    const analyticsStart = new Date(2026, 5, 1, 8, 0, 0, 0);
    mockClampEventWindow.mockResolvedValueOnce({
      from: analyticsStart,
      to: requestedTo,
      clamped: true,
      analyticsStartDate: "2026-06-01",
    });

    await listMovements(
      {
        locationId: 3,
        from: new Date(2026, 0, 1, 8, 0, 0, 0),
        to: requestedTo,
      },
      { page: 1, pageSize: 25 },
    );

    expect(mockPrisma.stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          locationId: 3,
          createdAt: { gte: analyticsStart, lte: requestedTo },
        },
      }),
    );
  });
});
