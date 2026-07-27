/**
 * Guards the history-browse permission catalog defaults introduced for
 * trucks + billet receipts list date filtering.
 */
import { describe, it, expect } from "vitest";
import { RBAC_PERMISSIONS, RBAC_ROLE_PERMISSIONS } from "../../prisma/rbac-source";

const TRUCK_HISTORY = "truck.view_history";
const BILLET_HISTORY = "billet.receipt.view_history";

describe("RBAC history browse permissions", () => {
  it("registers both history permission codes in the catalog", () => {
    const codes = new Set(RBAC_PERMISSIONS.map((p) => p.code));
    expect(codes.has(TRUCK_HISTORY)).toBe(true);
    expect(codes.has(BILLET_HISTORY)).toBe(true);
  });

  it("grants both history permissions to manager by default", () => {
    const manager = RBAC_ROLE_PERMISSIONS.manager ?? [];
    expect(manager).toContain(TRUCK_HISTORY);
    expect(manager).toContain(BILLET_HISTORY);
  });

  it("does not grant history permissions to operational roles by default", () => {
    for (const role of ["logistics", "scale_operator", "internal_loader", "finance"] as const) {
      const perms = RBAC_ROLE_PERMISSIONS[role] ?? [];
      expect(perms, role).not.toContain(TRUCK_HISTORY);
      expect(perms, role).not.toContain(BILLET_HISTORY);
    }
  });

  it("does not seed admin role defaults (admin resolves all at runtime)", () => {
    expect(RBAC_ROLE_PERMISSIONS.admin).toBeUndefined();
  });
});
