import { describe, it, expect } from "vitest";
import {
  computeWeighbridgeDiscrepancy,
  isWeighbridgeDiscrepancyWarning,
  buildWeighbridgeDiscrepancyAuditFields,
} from "./weighbridge-discrepancy";

describe("computeWeighbridgeDiscrepancy", () => {
  it("returns zero discrepancy when bridge net matches internal total", () => {
    const result = computeWeighbridgeDiscrepancy({
      tareKg: 10_000,
      grossKg: 25_000,
      internalTotalTons: 15,
    });
    expect(result.bridgeNetKg).toBe(15_000);
    expect(result.internalKg).toBe(15_000);
    expect(result.discrepancyKg).toBe(0);
  });

  it("uses absolute difference when internal total exceeds bridge net", () => {
    const result = computeWeighbridgeDiscrepancy({
      tareKg: 10_000,
      grossKg: 25_000,
      internalTotalTons: 15.5,
    });
    expect(result.discrepancyKg).toBe(500);
  });

  it("uses absolute difference when bridge net exceeds internal total", () => {
    const result = computeWeighbridgeDiscrepancy({
      tareKg: 10_000,
      grossKg: 25_300,
      internalTotalTons: 15.05,
    });
    expect(result.discrepancyKg).toBe(250);
  });
});

describe("isWeighbridgeDiscrepancyWarning", () => {
  it("does not warn at or below threshold", () => {
    expect(isWeighbridgeDiscrepancyWarning(200, 200)).toBe(false);
    expect(isWeighbridgeDiscrepancyWarning(150, 200)).toBe(false);
  });

  it("warns above threshold", () => {
    expect(isWeighbridgeDiscrepancyWarning(201, 200)).toBe(true);
  });
});

describe("buildWeighbridgeDiscrepancyAuditFields", () => {
  it("includes warning flag and threshold", () => {
    const fields = buildWeighbridgeDiscrepancyAuditFields({
      tareKg: 10_000,
      grossKg: 25_300,
      internalTotalTons: 15.05,
    });
    expect(fields.bridgeNetKg).toBe(15_300);
    expect(fields.internalTotalTons).toBe(15.05);
    expect(fields.discrepancyKg).toBe(250);
    expect(fields.discrepancyWarning).toBe(true);
    expect(fields.discrepancyThresholdKg).toBeGreaterThan(0);
  });
});
