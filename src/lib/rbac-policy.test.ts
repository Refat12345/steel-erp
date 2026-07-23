import { describe, expect, it } from "vitest";
import {
  collectPermissionOverrideWarnings,
  getRoleLandingPage,
  resolveLandingPage,
} from "./rbac-policy";

describe("collectPermissionOverrideWarnings", () => {
  it("warns when analytics permissions are enabled for scale_operator", () => {
    const effectiveEnabled = new Map([
      ["dashboard.view", true],
      ["payment.view", false],
    ]);

    const warnings = collectPermissionOverrideWarnings({
      targetRoleCode: "scale_operator",
      effectiveEnabled,
    });

    expect(warnings.some((w) => w.includes("dashboard.view"))).toBe(true);
    expect(warnings.some((w) => w.includes("scale_operator"))).toBe(true);
  });

  it("returns no warnings for unrestricted roles", () => {
    const warnings = collectPermissionOverrideWarnings({
      targetRoleCode: "finance",
      effectiveEnabled: new Map([["dashboard.view", true]]),
    });

    expect(warnings).toHaveLength(0);
  });
});

describe("getRoleLandingPage", () => {
  it("maps shop-floor roles to /trucks", () => {
    expect(getRoleLandingPage("internal_loader")).toBe("/trucks");
    expect(getRoleLandingPage("scale_operator")).toBe("/trucks");
    expect(getRoleLandingPage("logistics")).toBe("/trucks");
  });

  it("returns null for dashboard roles", () => {
    expect(getRoleLandingPage("admin")).toBeNull();
    expect(getRoleLandingPage("manager")).toBeNull();
  });
});

describe("resolveLandingPage", () => {
  it("keeps internal_loader on /trucks when they still have truck access", () => {
    expect(
      resolveLandingPage({
        roleCode: "internal_loader",
        permissions: ["truck.view_queue"],
        stockModuleEnabled: true,
      }),
    ).toBe("/trucks");
  });

  it("sends stock-only internal_loader to production-in (rami1 case)", () => {
    expect(
      resolveLandingPage({
        roleCode: "internal_loader",
        permissions: ["stock.view", "stock.production.ton"],
        stockModuleEnabled: true,
      }),
    ).toBe("/stock/production-in");
  });

  it("falls back to /stock when only stock.view is granted", () => {
    expect(
      resolveLandingPage({
        roleCode: "internal_loader",
        permissions: ["stock.view"],
        stockModuleEnabled: true,
      }),
    ).toBe("/stock");
  });

  it("skips stock landings when the stock module is dark-launched off", () => {
    expect(
      resolveLandingPage({
        roleCode: "internal_loader",
        permissions: ["stock.view", "stock.production.ton"],
        stockModuleEnabled: false,
      }),
    ).toBeNull();
  });

  it("avoids redirect loops when /trucks was just denied", () => {
    expect(
      resolveLandingPage({
        roleCode: "internal_loader",
        permissions: ["truck.view_queue", "stock.view"],
        stockModuleEnabled: true,
        excludePath: "/trucks",
      }),
    ).toBe("/stock");
  });

  it("sends manager/admin-capable users to / when they have dashboard.view", () => {
    expect(
      resolveLandingPage({
        roleCode: "manager",
        permissions: ["dashboard.view", "contract.view"],
        stockModuleEnabled: true,
      }),
    ).toBe("/");
  });

  it("never lands scale_operator on / even with dashboard.view granted", () => {
    expect(
      resolveLandingPage({
        roleCode: "scale_operator",
        permissions: ["dashboard.view", "truck.view_approved"],
        stockModuleEnabled: true,
      }),
    ).toBe("/trucks");
  });

  it("returns null when the user has no openable surface", () => {
    expect(
      resolveLandingPage({
        roleCode: "internal_loader",
        permissions: [],
        stockModuleEnabled: true,
      }),
    ).toBeNull();
  });
});
