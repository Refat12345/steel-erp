import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  systemSetting: { findUnique: vi.fn() },
  sizeLookup: { findUnique: vi.fn(), findMany: vi.fn() },
  plcTelemetry: { findFirst: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
  revalidateTag: vi.fn(),
}));

import {
  getLatestMillLiveSnapshot,
  listMillLiveSizeOptions,
} from "./mill-live.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listMillLiveSizeOptions", () => {
  it("returns only active bundle sizes with the request locale label", async () => {
    mockPrisma.sizeLookup.findMany.mockResolvedValue([
      {
        id: 1,
        code: "12mm",
        displayName: "12 مم",
        displayNameEn: "12mm",
        isBundleType: true,
        isSpecialRatio: false,
      },
      {
        id: 2,
        code: "scrap",
        displayName: "خردة",
        displayNameEn: "Scrap",
        isBundleType: false,
        isSpecialRatio: false,
      },
    ]);

    await expect(listMillLiveSizeOptions("en")).resolves.toEqual([
      { id: 1, displayName: "12mm" },
    ]);
  });
});

describe("getLatestMillLiveSnapshot", () => {
  it("uses the admin-selected catalog size, not the PLC register", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: "4" });
    mockPrisma.sizeLookup.findUnique.mockResolvedValue({
      displayName: "16 مم",
      displayNameEn: "16mm",
    });
    mockPrisma.plcTelemetry.findFirst.mockResolvedValue({
      totalBillets: 20,
      frontPackCount: 3,
      backPackCount: 2,
      hourlyBreakdown: Array.from({ length: 24 }, () => 1),
      createdAt: new Date(),
    });

    const snapshot = await getLatestMillLiveSnapshot("ar");

    expect(snapshot.productSizeId).toBe(4);
    expect(snapshot.productSizeLabel).toBe("16 مم");
    expect(snapshot.totalBillets).toBe(20);
    expect(snapshot.isLive).toBe(true);
    expect(snapshot.createdAt).not.toBeNull();
  });

  it("still returns the admin size when no SCADA snapshot exists", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: "4" });
    mockPrisma.sizeLookup.findUnique.mockResolvedValue({
      displayName: "16 مم",
      displayNameEn: "16mm",
    });
    mockPrisma.plcTelemetry.findFirst.mockResolvedValue(null);

    const snapshot = await getLatestMillLiveSnapshot("en");

    expect(snapshot).toMatchObject({
      productSizeId: 4,
      productSizeLabel: "16mm",
      totalBillets: 0,
      frontPackCount: 0,
      backPackCount: 0,
      createdAt: null,
      isLive: false,
    });
    expect(snapshot.hourlyBreakdown).toHaveLength(24);
  });

  it("clears the size when the stored id no longer exists", async () => {
    mockPrisma.systemSetting.findUnique.mockResolvedValue({ value: "99" });
    mockPrisma.sizeLookup.findUnique.mockResolvedValue(null);
    mockPrisma.plcTelemetry.findFirst.mockResolvedValue(null);

    const snapshot = await getLatestMillLiveSnapshot("ar");

    expect(snapshot.productSizeId).toBeNull();
    expect(snapshot.productSizeLabel).toBeNull();
  });
});
