import { describe, expect, it } from "vitest";
import { RBAC_PERMISSIONS, RBAC_ROLE_PERMISSIONS } from "../../prisma/rbac-source";

describe("document library permissions", () => {
  it("keeps view and manage off default roles, and gives the owner read-all", () => {
    const codes = new Set(RBAC_PERMISSIONS.map((permission) => permission.code));
    expect(codes.has("document.view")).toBe(true);
    expect(codes.has("document.view_all")).toBe(true);
    expect(codes.has("document.manage")).toBe(true);

    expect(RBAC_ROLE_PERMISSIONS.manager).toContain("document.view_all");

    for (const [role, granted] of Object.entries(RBAC_ROLE_PERMISSIONS)) {
      expect(granted).not.toContain("document.view");
      expect(granted).not.toContain("document.manage");
      if (role !== "manager") expect(granted).not.toContain("document.view_all");
    }
  });
});
