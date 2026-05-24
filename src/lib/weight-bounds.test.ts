import { describe, it, expect } from "vitest";
import {
  MIN_WEIGHT_KG,
  MAX_WEIGHT_KG,
  validateWeightRange,
  validateTareWeight,
  validateGrossWeight,
} from "./weight-bounds";

describe("validateWeightRange — hard rails", () => {
  it("accepts MIN_WEIGHT_KG (100)", () => {
    expect(MIN_WEIGHT_KG).toBe(100);
    expect(validateWeightRange(MIN_WEIGHT_KG)).toBeNull();
  });

  it("accepts MAX_WEIGHT_KG (100 000)", () => {
    expect(MAX_WEIGHT_KG).toBe(100_000);
    expect(validateWeightRange(MAX_WEIGHT_KG)).toBeNull();
  });

  it.each([0, -1, 99, 100_001, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects %s",
    (v) => {
      expect(validateWeightRange(v)).toBeTruthy();
    },
  );
});

describe("validateTareWeight", () => {
  it("rejects below deployment minimum", () => {
    expect(validateTareWeight(500)).toMatch(/وزن الفارغ/);
  });
  it("accepts typical road-truck tare", () => {
    expect(validateTareWeight(10_000)).toBeNull();
  });
});

describe("validateGrossWeight — relationship to tare", () => {
  it("rejects gross <= tare", () => {
    expect(validateGrossWeight(10_000, 10_000)).toMatch(/يجب أن يكون أكبر/);
    expect(validateGrossWeight(9_999, 10_000)).toMatch(/يجب أن يكون أكبر/);
  });

  it("rejects net below deployment minimum even when gross > tare", () => {
    // Net = 100 kg, below NET_MIN_KG = 500.
    expect(validateGrossWeight(10_100, 10_000)).toMatch(/صافي الوزن/);
  });

  it("accepts a plausible gross on top of tare", () => {
    expect(validateGrossWeight(25_000, 10_000)).toBeNull();
  });

  it("accepts gross at deployment maximum (100 000 kg)", () => {
    expect(validateGrossWeight(MAX_WEIGHT_KG, 10_000)).toBeNull();
  });
});
