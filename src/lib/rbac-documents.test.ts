import { describe, expect, it } from "vitest";
import { RBAC_PERMISSIONS, RBAC_ROLE_PERMISSIONS } from "../../prisma/rbac-source";

describe("document library permissions", () => {
  it("registers view and manage without granting them to a default role", () => {
    const codes = new Set(RBAC_PERMISSIONS.map((permission) => permission.code));
    expect(codes.has("document.view")).toBe(true);
    expect(codes.has("document.manage")).toBe(true);

    for (const granted of Object.values(RBAC_ROLE_PERMISSIONS)) {
      expect(granted).not.toContain("document.view");
      expect(granted).not.toContain("document.manage");
    }
  });
});
