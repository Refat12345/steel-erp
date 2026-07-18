/**
 * Admin finance-card correction API — auth, permission, validation, and
 * service wiring for PATCH /api/trucks/:id/admin-corrections/external-card.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetApiSession = vi.hoisted(() => vi.fn());
const mockHasPermission = vi.hoisted(() => vi.fn());
const mockCorrect = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-utils", () => ({
  getApiSession: mockGetApiSession,
  hasPermission: mockHasPermission,
  unauthorized: () =>
    Response.json({ success: false, error: "غير مصرح بالدخول" }, { status: 401 }),
  forbidden: () =>
    Response.json(
      { success: false, error: "لا تملك صلاحية لهذه العملية" },
      { status: 403 },
    ),
  badRequest: (msg: string) =>
    Response.json({ success: false, error: msg }, { status: 400 }),
  ok: (data: unknown) => Response.json({ success: true, data }),
  handleServiceError: (e: unknown) => {
    const err = e as { message?: string; code?: string };
    const status = err.code === "CONFLICT" ? 409 : err.code === "NOT_FOUND" ? 404 : 400;
    return Response.json(
      { success: false, error: err.message ?? "خطأ" },
      { status },
    );
  },
}));

vi.mock("@/lib/idempotency", () => ({
  readJsonBody: async (req: Request) => {
    const text = await req.text();
    try {
      return { ok: true as const, text, json: JSON.parse(text) };
    } catch {
      return { ok: false as const };
    }
  },
  withIdempotency: async (
    _req: unknown,
    _userId: number,
    _body: string,
    compute: () => Promise<Response>,
  ) => compute(),
}));

vi.mock("@/lib/services/truck.service", () => ({
  correctCompletedExternalCardNumber: mockCorrect,
}));

import { PATCH } from "./route";
import { ServiceError } from "@/lib/services/errors";

function patchReq(body: unknown, id = "1") {
  return new NextRequest(
    `http://localhost/api/trucks/${id}/admin-corrections/external-card`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "test-key-1",
      },
      body: JSON.stringify(body),
    },
  );
}

const params = (id: string) => Promise.resolve({ id });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetApiSession.mockResolvedValue({ userId: 7, permissions: ["scale.correct_completed"] });
  mockHasPermission.mockReturnValue(true);
  mockCorrect.mockResolvedValue({
    id: 1,
    status: "Completed",
    externalCardNumber: "WB-2002",
  });
});

describe("PATCH /api/trucks/:id/admin-corrections/external-card", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetApiSession.mockResolvedValue(null);
    const res = await PATCH(patchReq({
      externalCardNumber: "WB-2002",
      reason: "تصحيح",
      expectedVersion: 0,
    }), { params: params("1") });
    expect(res.status).toBe(401);
    expect(mockCorrect).not.toHaveBeenCalled();
  });

  it("returns 403 without scale.correct_completed", async () => {
    mockHasPermission.mockReturnValue(false);
    const res = await PATCH(patchReq({
      externalCardNumber: "WB-2002",
      reason: "تصحيح",
      expectedVersion: 0,
    }), { params: params("1") });
    expect(res.status).toBe(403);
    expect(mockHasPermission).toHaveBeenCalledWith(
      expect.anything(),
      "scale.correct_completed",
    );
    expect(mockCorrect).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid truck id", async () => {
    const res = await PATCH(patchReq({
      externalCardNumber: "WB-2002",
      reason: "تصحيح",
      expectedVersion: 0,
    }), { params: params("abc") });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalidId");
    expect(mockCorrect).not.toHaveBeenCalled();
  });

  it("returns 400 when the card number is empty / whitespace", async () => {
    const res = await PATCH(patchReq({
      externalCardNumber: "   ",
      reason: "تصحيح",
      expectedVersion: 0,
    }), { params: params("1") });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("externalCardNumberRequired");
    expect(mockCorrect).not.toHaveBeenCalled();
  });

  it("returns 400 when the reason is missing", async () => {
    const res = await PATCH(patchReq({
      externalCardNumber: "WB-2002",
      reason: "",
      expectedVersion: 0,
    }), { params: params("1") });
    expect(res.status).toBe(400);
    expect(mockCorrect).not.toHaveBeenCalled();
  });

  it("calls the service with trimmed card number and returns ok", async () => {
    const res = await PATCH(patchReq({
      externalCardNumber: "  WB-2002  ",
      reason: "خطأ إدخال عند الإغلاق",
      expectedVersion: 2,
    }), { params: params("42") });
    expect(res.status).toBe(200);
    expect(mockCorrect).toHaveBeenCalledWith(
      42,
      "WB-2002",
      "خطأ إدخال عند الإغلاق",
      2,
      7,
    );
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.externalCardNumber).toBe("WB-2002");
  });

  it("surfaces a service conflict (duplicate card) as 409", async () => {
    mockCorrect.mockRejectedValue(
      new ServiceError("رقم كرت القبان WB-9 مستخدم مسبقاً في العملية #99", "CONFLICT"),
    );
    const res = await PATCH(patchReq({
      externalCardNumber: "WB-9",
      reason: "تصحيح",
      expectedVersion: 0,
    }), { params: params("1") });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/مستخدم مسبقاً/);
  });
});
