import { describe, expect, it } from "vitest";

import { sliceReportByProductFilter } from "./report-product-filter";

describe("sliceReportByProductFilter — SHORTBAR / SCRAP", () => {
  const mixedSessions = [
    {
      bridgeRoundId: 1,
      weightTons: 12,
      sizeId: 8,
      size: { code: "8" },
    },
    {
      bridgeRoundId: 2,
      weightTons: 2,
      sizeId: 101,
      size: { code: "shortbar_1_4m" },
    },
    {
      bridgeRoundId: 3,
      weightTons: 3,
      sizeId: 102,
      size: { code: "shortbar_4_12m" },
    },
    {
      bridgeRoundId: 4,
      weightTons: 1.5,
      sizeId: 103,
      size: { code: "scrap" },
    },
  ];

  const mixedTruck = {
    operationalGrade: "FIRST" as const,
    rounds: [
      { id: 1, grade: "FIRST" as const, startWeightKg: 10_000, endWeightKg: 25_000 },
      { id: 2, grade: null, startWeightKg: 25_000, endWeightKg: 27_000 },
      { id: 3, grade: null, startWeightKg: 27_000, endWeightKg: 30_000 },
      { id: 4, grade: null, startWeightKg: 30_000, endWeightKg: 31_500 },
    ],
  };

  it("combines shortbar_1_4m and shortbar_4_12m rounds under SHORTBAR filter", () => {
    const slice = sliceReportByProductFilter(mixedTruck, "SHORTBAR", 21.5, mixedSessions);

    expect(slice.included).toBe(true);
    expect(slice.bridgeTons).toBe(5);
    expect(slice.internalTons).toBe(5);
    expect(slice.matchingRoundIds).toEqual([2, 3]);
    expect(slice.isPartialVisit).toBe(true);
  });

  it("includes scrap round only for SCRAP filter", () => {
    const slice = sliceReportByProductFilter(mixedTruck, "SCRAP", 21.5, mixedSessions);

    expect(slice.included).toBe(true);
    expect(slice.bridgeTons).toBe(1.5);
    expect(slice.internalTons).toBe(1.5);
    expect(slice.matchingRoundIds).toEqual([4]);
    expect(slice.isPartialVisit).toBe(true);
  });

  it("excludes shortbar-only visit from FIRST filter", () => {
    const shortbarOnly = {
      rounds: [{ id: 10, grade: null, startWeightKg: 10_000, endWeightKg: 15_000 }],
    };
    const sessions = [
      {
        bridgeRoundId: 10,
        weightTons: 4,
        sizeId: 101,
        size: { code: "shortbar_4_12m" },
      },
    ];

    const slice = sliceReportByProductFilter(shortbarOnly, "FIRST", 5, sessions);
    expect(slice.included).toBe(false);
  });

  it("includes legacy shortbar truck without rounds via sessions", () => {
    const legacy = { operationalGrade: null, rounds: [] };
    const sessions = [
      { bridgeRoundId: null, weightTons: 6, sizeId: 101, size: { code: "shortbar_1_4m" } },
    ];

    const slice = sliceReportByProductFilter(legacy, "SHORTBAR", 6, sessions);
    expect(slice.included).toBe(true);
    expect(slice.bridgeTons).toBe(6);
    expect(slice.internalTons).toBe(6);
    expect(slice.isPartialVisit).toBe(false);
  });
});
