/**
 * GET /api/trucks — history permission gates operational-date browsing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { defaultOperationalDateInput, getOperationalDayWindow } from "@/lib/operational-day";

const mockGetApiSession = vi.hoisted(() => vi.fn());
const mockListOperations = vi.hoisted(() => vi.fn());
const mockGetAnalyticsStartDateValue = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-utils")>(
    "@/lib/api-utils",
  );
  return {
    ...actual,
    getApiSession: mockGetApiSession,
    unauthorized: async () =>
      Response.json({ success: false, error: "unauthorized" }, { status: 401 }),
    forbidden: async () =>
      Response.json({ success: false, error: "forbidden" }, { status: 403 }),
    badRequest: async (msg: string) =>
      Response.json({ success: false, error: msg }, { status: 400 }),
  };
});

vi.mock("@/lib/services/truck.service", () => ({
  listOperations: mockListOperations,
  registerTruck: vi.fn(),
}));

vi.mock("@/lib/services/settings.service", () => ({
  getAnalyticsStartDateValue: mockGetAnalyticsStartDateValue,
}));

vi.mock("@/lib/i18n/request-locale", () => ({
  getRequestLocale: async () => "ar",
}));

vi.mock("@/lib/localized-name", () => ({
  withLocalizedTruckLabels: (row: unknown) => row,
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { GET } from "./route";

function req(query = "") {
  const qs = query ? `?${query}` : "";
  return new NextRequest(`http://localhost/api/trucks${qs}`);
}

const operatorSession = {
  userId: 6,
  username: "loader",
  role: "internal_loader",
  permissions: ["truck.view_approved"],
};

const historySession = {
  userId: 3,
  username: "manager",
  role: "manager",
  permissions: ["truck.view_queue", "truck.view_history"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListOperations.mockResolvedValue({
    data: [{ id: 1, plateNumber: "123" }],
    total: 1,
    page: 1,
    pageSize: 25,
  });
  mockGetAnalyticsStartDateValue.mockResolvedValue("2026-01-01");
});

describe("GET /api/trucks history gate", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetApiSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockListOperations).not.toHaveBeenCalled();
  });

  it("returns 403 without truck view permissions", async () => {
    mockGetApiSession.mockResolvedValue({
      ...operatorSession,
      permissions: ["payment.view"],
    });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockListOperations).not.toHaveBeenCalled();
  });

  it("forces today's window when history is missing and date omitted", async () => {
    mockGetApiSession.mockResolvedValue(operatorSession);
    const today = defaultOperationalDateInput();
    const window = getOperationalDayWindow(today);

    const res = await GET(req("page=1&pageSize=25"));
    expect(res.status).toBe(200);
    expect(mockListOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: window.from,
        dateTo: window.to,
      }),
      expect.anything(),
    );
  });

  it("allows today's operational date without history permission", async () => {
    mockGetApiSession.mockResolvedValue(operatorSession);
    const today = defaultOperationalDateInput();
    const window = getOperationalDayWindow(today);

    const res = await GET(req(`operationalDate=${today}`));
    expect(res.status).toBe(200);
    expect(mockListOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: window.from,
        dateTo: window.to,
      }),
      expect.anything(),
    );
  });

  it("returns 403 for a past date without history permission", async () => {
    mockGetApiSession.mockResolvedValue(operatorSession);
    const res = await GET(req("operationalDate=2026-01-15"));
    expect(res.status).toBe(403);
    expect(mockListOperations).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid date without history permission", async () => {
    mockGetApiSession.mockResolvedValue(operatorSession);
    const res = await GET(req("operationalDate=not-a-date"));
    expect(res.status).toBe(400);
    expect(mockListOperations).not.toHaveBeenCalled();
  });

  it("allows a past date when truck.view_history is present", async () => {
    mockGetApiSession.mockResolvedValue(historySession);
    const window = getOperationalDayWindow("2026-01-15");

    const res = await GET(req("operationalDate=2026-01-15"));
    expect(res.status).toBe(200);
    expect(mockListOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: window.from,
        dateTo: window.to,
      }),
      expect.anything(),
    );
  });

  it("keeps open-ended list when history is allowed and date omitted", async () => {
    mockGetApiSession.mockResolvedValue(historySession);

    const res = await GET(req("page=1"));
    expect(res.status).toBe(200);
    expect(mockListOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: undefined,
        dateTo: undefined,
      }),
      expect.anything(),
    );
  });
});
