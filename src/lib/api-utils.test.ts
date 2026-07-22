import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
  }),
}));

import {
  hasPermission,
  hasAnyPermission,
  STOCK_STRUCTURE_READ_PERMISSIONS,
  parsePagination,
  handleServiceError,
} from "./api-utils";
import type { ApiSession } from "./api-utils";
import { ServiceError } from "./services/errors";
import { translateError } from "@/lib/i18n/server-messages";

// ─── hasPermission ─────────────────────────────────────────────

describe("hasPermission", () => {
  const admin: ApiSession = {
    userId: 1,
    username: "admin",
    role: "admin",
    permissions: ["any.thing", "contract.view", "contract.create"],
  };

  const user: ApiSession = {
    userId: 2,
    username: "user",
    role: "finance",
    permissions: ["contract.view", "payment.view"],
  };

  it("authorizes admin through their permission set (no role-based bypass)", () => {
    expect(hasPermission(admin, "any.thing")).toBe(true);
  });

  it("denies admin if the code is genuinely absent from the permission set", () => {
    const strippedAdmin: ApiSession = { ...admin, permissions: [] };
    expect(hasPermission(strippedAdmin, "any.thing")).toBe(false);
  });

  it("returns true when permission is in the list", () => {
    expect(hasPermission(user, "contract.view")).toBe(true);
  });

  it("returns false when permission is missing", () => {
    expect(hasPermission(user, "contract.create")).toBe(false);
  });
});

// ─── hasAnyPermission / stock structure reads ──────────────────

describe("hasAnyPermission", () => {
  const productionClerk: ApiSession = {
    userId: 3,
    username: "prod",
    role: "logistics",
    permissions: ["stock.production.bundle"],
  };

  it("returns true when at least one listed code is held", () => {
    expect(
      hasAnyPermission(
        productionClerk,
        "stock.view",
        "stock.production.bundle",
        "stock.transfer",
      ),
    ).toBe(true);
  });

  it("returns false when none of the listed codes are held", () => {
    expect(
      hasAnyPermission(productionClerk, "stock.view", "stock.transfer"),
    ).toBe(false);
  });

  it("lets a production clerk pass STOCK_STRUCTURE_READ_PERMISSIONS", () => {
    expect(
      hasAnyPermission(productionClerk, ...STOCK_STRUCTURE_READ_PERMISSIONS),
    ).toBe(true);
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps BAD_REQUEST to 400 and translates messageKey", async () => {
    const res = await handleServiceError(new ServiceError("invalidData"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: translateError("ar", "invalidData"),
    });
  });

  it("maps NOT_FOUND to 404", async () => {
    const res = await handleServiceError(
      new ServiceError("operationNotFound", "NOT_FOUND"),
    );
    expect(res.status).toBe(404);
  });

  it("maps FORBIDDEN to 403", async () => {
    const res = await handleServiceError(
      new ServiceError("forbidden", "FORBIDDEN"),
    );
    expect(res.status).toBe(403);
  });

  it("returns generic 500 for unknown errors", async () => {
    const res = await handleServiceError(new Error("unexpected"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe(translateError("ar", "internalServer"));
  });
});
