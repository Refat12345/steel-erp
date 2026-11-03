/**
 * The loader-trucks report is a catalog permission only. No role receives it
 * by default — admin resolves every catalog code at runtime, and a factory
 * owner sees the report only after an explicit per-user grant.
 */
import { describe, it, expect } from "vitest";
import { RBAC_PERMISSIONS, RBAC_ROLE_PERMISSIONS } from "../../prisma/rbac-source";

const LOADER_TRUCKS = "report.loader_trucks";

describe("RBAC loader trucks report permission", () => {
  it("registers the permission in the catalog", () => {
    const codes = new Set(RBAC_PERMISSIONS.map((permission) => permission.code));
    expect(codes.has(LOADER_TRUCKS)).toBe(true);
  });

  it("does not grant the permission to any role by default", () => {
    for (const [role, perms] of Object.entries(RBAC_ROLE_PERMISSIONS)) {
      expect(perms, role).not.toContain(LOADER_TRUCKS);
    }
    expect(RBAC_ROLE_PERMISSIONS.manager ?? []).not.toContain(LOADER_TRUCKS);
  });

  it("does not seed admin role defaults (admin resolves all at runtime)", () => {
    expect(RBAC_ROLE_PERMISSIONS.admin).toBeUndefined();
  });
});
