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
