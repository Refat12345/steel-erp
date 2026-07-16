/**
 * Operations dashboard API — auth, period parsing, and ops-tier gating.
 *
 * The route is a thin controller: it must never leak OPS fields to callers
 * without `dashboard.ops.view`, and Owner-tier callers must not trigger
 * the OPS aggregate at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetApiSession = vi.hoisted(() => vi.fn());
const mockGetOwnerStatsCached = vi.hoisted(() => vi.fn());
const mockGetOpsStatsCached = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-utils", () => ({
  getApiSession: mockGetApiSession,
  unauthorized: () =>
    Response.json(
      { success: false, error: "غير مصرح بالدخول" },
      { status: 401 },
    ),
  forbidden: () =>
    Response.json(
      { success: false, error: "لا تملك صلاحية لهذه العملية" },
      { status: 403 },
    ),
}));

vi.mock("@/lib/services/operations-stats.service", () => ({
  getOwnerStatsCached: mockGetOwnerStatsCached,
  getOpsStatsCached: mockGetOpsStatsCached,
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { GET } from "./route";

function req(period?: string) {
  const url = period
    ? `http://localhost/api/dashboard/operations-stats?period=${period}`
    : "http://localhost/api/dashboard/operations-stats";
  return new NextRequest(url);
}

const ownerPayload = {
  period: "today",
  analyticsStartDate: null,
  kpis: {
    completedTrucks: 1,
    totalTons: 10,
    servedCustomers: 1,
    servedDestinations: 0,
  },
  trends: {},
  pulse: {},
  recentDeliveries: [],
  activity: { granularity: "hour", points: [] },
  topCustomers: [],
  topDestinations: [],
  tonsByKind: [],
  tonsByGrade: [],
};

const opsPayload = {
  kpis: {
    activeNow: 5,
    onScaleNow: 2,
    stuckNow: 1,
    cancellationPct30d: 10,
  },
  fleetStatus: [],
  onScale: [],
  averages30d: {
    avgCycleMin: null,
    avgWaitBeforeTareMin: null,
    avgLoadingMin: null,
  },
  stuckTrucks: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOwnerStatsCached.mockResolvedValue(ownerPayload);
  mockGetOpsStatsCached.mockResolvedValue(opsPayload);
});

describe("GET /api/dashboard/operations-stats", () => {
  it("returns 401 when there is no session", async () => {
    mockGetApiSession.mockResolvedValue(null);

    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockGetOwnerStatsCached).not.toHaveBeenCalled();
  });

  it("returns 403 when the role is analytics-restricted (scale_operator)", async () => {
    mockGetApiSession.mockResolvedValue({
      userId: 1,
      username: "scale1",
      role: "scale_operator",
      permissions: ["dashboard.view", "dashboard.ops.view"],
    });

    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockGetOwnerStatsCached).not.toHaveBeenCalled();
  });

  it("returns 403 when the user lacks dashboard.view", async () => {
    mockGetApiSession.mockResolvedValue({
      userId: 2,
      username: "clerk",
      role: "sales",
      permissions: ["contract.view"],
    });

    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it("defaults period to today and omits OPS when caller lacks dashboard.ops.view", async () => {
    mockGetApiSession.mockResolvedValue({
      userId: 3,
      username: "manager",
      role: "manager",
      permissions: ["dashboard.view"],
    });

    const res = await GET(req("bogus"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockGetOwnerStatsCached).toHaveBeenCalledWith("today");
    expect(mockGetOpsStatsCached).not.toHaveBeenCalled();
    expect(body).toEqual({
      success: true,
      data: { owner: ownerPayload, ops: null },
    });
  });

  it("forwards week/month periods and includes OPS for ops-permission holders", async () => {
    mockGetApiSession.mockResolvedValue({
      userId: 4,
      username: "ops",
      role: "operations",
      permissions: ["dashboard.view", "dashboard.ops.view"],
    });

    for (const period of ["week", "month"] as const) {
      vi.clearAllMocks();
      mockGetOwnerStatsCached.mockResolvedValue({
        ...ownerPayload,
        period,
      });
      mockGetOpsStatsCached.mockResolvedValue(opsPayload);

      const res = await GET(req(period));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(mockGetOwnerStatsCached).toHaveBeenCalledWith(period);
      expect(mockGetOpsStatsCached).toHaveBeenCalledOnce();
      expect(body.data.ops).toEqual(opsPayload);
      expect(body.data.owner.period).toBe(period);
    }
  });

  it("returns 500 with Arabic error when the service throws", async () => {
    mockGetApiSession.mockResolvedValue({
      userId: 5,
      username: "manager",
      role: "manager",
      permissions: ["dashboard.view"],
    });
    mockGetOwnerStatsCached.mockRejectedValue(new Error("db down"));

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: "خطأ في جلب الإحصاءات",
    });
  });
});
