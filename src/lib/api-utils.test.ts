import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  hasPermission,
  parsePagination,
  handleServiceError,
} from "./api-utils";
import type { ApiSession } from "./api-utils";
import { ServiceError } from "./services/errors";

// ─── hasPermission ─────────────────────────────────────────────

describe("hasPermission", () => {
  const admin: ApiSession = {
    userId: 1,
    username: "admin",
    role: "admin",
    permissions: [],
  };

  const user: ApiSession = {
    userId: 2,
    username: "user",
    role: "finance",
    permissions: ["contract.view", "payment.view"],
  };

  it("returns true for admin regardless of permission code", () => {
    expect(hasPermission(admin, "any.thing")).toBe(true);
  });

  it("returns true when permission is in the list", () => {
    expect(hasPermission(user, "contract.view")).toBe(true);
  });

  it("returns false when permission is missing", () => {
    expect(hasPermission(user, "contract.create")).toBe(false);
  });
});

// ─── parsePagination ───────────────────────────────────────────

describe("parsePagination", () => {
  it("returns defaults when no params provided", () => {
    const result = parsePagination(new URLSearchParams());
    expect(result).toEqual({ page: 1, pageSize: 25 });
  });

  it("parses valid page and pageSize", () => {
    const result = parsePagination(
      new URLSearchParams({ page: "3", pageSize: "50" }),
    );
    expect(result).toEqual({ page: 3, pageSize: 50 });
  });

  it("clamps page to minimum 1", () => {
    const result = parsePagination(new URLSearchParams({ page: "-5" }));
    expect(result.page).toBe(1);
  });

  it("clamps pageSize to maximum 100", () => {
    const result = parsePagination(new URLSearchParams({ pageSize: "999" }));
    expect(result.pageSize).toBe(100);
  });

  it("falls back to default when pageSize is 0 (falsy)", () => {
    const result = parsePagination(new URLSearchParams({ pageSize: "0" }));
    expect(result.pageSize).toBe(25);
  });

  it("handles non-numeric strings gracefully", () => {
    const result = parsePagination(
      new URLSearchParams({ page: "abc", pageSize: "xyz" }),
    );
    expect(result).toEqual({ page: 1, pageSize: 25 });
  });
});

// ─── handleServiceError ────────────────────────────────────────

describe("handleServiceError", () => {
  it("maps BAD_REQUEST to 400", async () => {
    const res = handleServiceError(new ServiceError("بيانات غير صالحة"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: "بيانات غير صالحة" });
  });

  it("maps NOT_FOUND to 404", async () => {
    const res = handleServiceError(
      new ServiceError("غير موجود", "NOT_FOUND"),
    );
    expect(res.status).toBe(404);
  });

  it("maps FORBIDDEN to 403", async () => {
    const res = handleServiceError(
      new ServiceError("ممنوع", "FORBIDDEN"),
    );
    expect(res.status).toBe(403);
  });

  it("returns generic 500 for unknown errors", async () => {
    const res = handleServiceError(new Error("unexpected"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("خطأ داخلي في الخادم");
  });
});
