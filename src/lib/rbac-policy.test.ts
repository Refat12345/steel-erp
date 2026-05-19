import { describe, expect, it } from "vitest";
import { collectPermissionOverrideWarnings } from "./rbac-policy";

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
