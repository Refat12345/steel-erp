import { describe, it, expect } from "vitest";
import { RBAC_PERMISSIONS, RBAC_ROLE_PERMISSIONS } from "../../prisma/rbac-source";

const MARK = "stock.classification.mark";

describe("RBAC stock classification mark permission", () => {
  it("registers stock.classification.mark in the catalog", () => {
    const codes = new Set(RBAC_PERMISSIONS.map((p) => p.code));
    expect(codes.has(MARK)).toBe(true);
    expect(codes.has("stock.view")).toBe(true);
  });

  it("is not a role default — admin grants it per user", () => {
    for (const role of Object.keys(RBAC_ROLE_PERMISSIONS)) {
      expect(RBAC_ROLE_PERMISSIONS[role], role).not.toContain(MARK);
    }
  });

  it("does not seed admin role defaults (admin resolves all at runtime)", () => {
    expect(RBAC_ROLE_PERMISSIONS.admin).toBeUndefined();
  });
});
