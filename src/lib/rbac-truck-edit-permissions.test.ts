import { describe, it, expect } from "vitest";
import { RBAC_PERMISSIONS, RBAC_ROLE_PERMISSIONS } from "../../prisma/rbac-source";

const REQUEST_ITEMS = "truck.edit_request_items";

describe("RBAC truck request-item edit permission", () => {
  it("registers truck.edit_request_items in the catalog", () => {
    const codes = new Set(RBAC_PERMISSIONS.map((p) => p.code));
    expect(codes.has(REQUEST_ITEMS)).toBe(true);
    expect(codes.has("truck.edit_approved")).toBe(true);
    expect(codes.has("truck.edit_queued")).toBe(true);
  });

  it("grants request-item edit to logistics by default", () => {
    expect(RBAC_ROLE_PERMISSIONS.logistics).toContain(REQUEST_ITEMS);
    expect(RBAC_ROLE_PERMISSIONS.logistics).toContain("truck.edit_approved");
  });

  it("does not grant request-item edit to scale or loader by default", () => {
    expect(RBAC_ROLE_PERMISSIONS.scale_operator).not.toContain(REQUEST_ITEMS);
    expect(RBAC_ROLE_PERMISSIONS.internal_loader).not.toContain(REQUEST_ITEMS);
    expect(RBAC_ROLE_PERMISSIONS.finance).not.toContain(REQUEST_ITEMS);
    expect(RBAC_ROLE_PERMISSIONS.manager).not.toContain(REQUEST_ITEMS);
  });
});
