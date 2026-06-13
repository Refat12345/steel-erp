import { describe, expect, it } from "vitest";

import {
  computeRoundNetTons,
  getDisplayGrade,
  sliceReportByGradeFilter,
  truckIncludedInGradeFilter,
} from "./truck-grade";

describe("truckIncludedInGradeFilter", () => {
  it("includes when at least one closed round matches", () => {
    expect(
      truckIncludedInGradeFilter(
        {
          operationalGrade: "FIRST",
          rounds: [
            { id: 1, grade: "FIRST", startWeightKg: 10_000, endWeightKg: 25_000 },
            { id: 2, grade: "SECOND", startWeightKg: 25_000, endWeightKg: 30_000 },
          ],
        },
        "FIRST",
      ),
    ).toBe(true);
    expect(
      truckIncludedInGradeFilter(
        {
          operationalGrade: "FIRST",
          rounds: [
            { id: 1, grade: "FIRST", startWeightKg: 10_000, endWeightKg: 25_000 },
            { id: 2, grade: null, startWeightKg: 25_000, endWeightKg: 28_000 },
          ],
        },
        "FIRST",
      ),
    ).toBe(true);
  });

  it("excludes when no closed round matches the filter", () => {
    expect(
      truckIncludedInGradeFilter(
        {
          rounds: [{ id: 1, grade: null, startWeightKg: 10_000, endWeightKg: 18_000 }],
        },
        "FIRST",
      ),
    ).toBe(false);
  });

  it("falls back to operation-level grade for legacy trucks", () => {
    const legacy = { operationalGrade: "FIRST" as const, salesOrder: null };
    expect(truckIncludedInGradeFilter(legacy, "FIRST")).toBe(true);
    expect(truckIncludedInGradeFilter(legacy, "SECOND")).toBe(false);
    expect(getDisplayGrade(legacy)).toBe("FIRST");
  });
});

describe("sliceReportByGradeFilter", () => {
  const sessions = [
    { bridgeRoundId: 1, weightTons: 12, sizeId: 8 },
    { bridgeRoundId: 2, weightTons: 5, sizeId: 12 },
    { bridgeRoundId: 3, weightTons: 2, sizeId: 99 },
  ];

  it("returns full visit when grade filter is null (all grades)", () => {
    const slice = sliceReportByGradeFilter(
      {
        operationalGrade: "FIRST",
        rounds: [
          { id: 1, grade: "FIRST", startWeightKg: 10_000, endWeightKg: 25_000 },
          { id: 2, grade: "SECOND", startWeightKg: 25_000, endWeightKg: 30_000 },
        ],
      },
      null,
      20,
      sessions,
    );

    expect(slice.included).toBe(true);
    expect(slice.bridgeTons).toBe(20);
    expect(slice.internalTons).toBe(19);
    expect(slice.sessions).toHaveLength(3);
    expect(slice.isPartialVisit).toBe(false);
    expect(slice.matchingRoundIds).toBeNull();
  });

  it("slices FIRST + SECOND visit to 15t for FIRST filter", () => {
    const slice = sliceReportByGradeFilter(
      {
        rounds: [
          { id: 1, grade: "FIRST", startWeightKg: 10_000, endWeightKg: 25_000 },
          { id: 2, grade: "SECOND", startWeightKg: 25_000, endWeightKg: 30_000 },
        ],
      },
      "FIRST",
      20,
      sessions,
    );

    expect(slice.included).toBe(true);
    expect(slice.bridgeTons).toBe(15);
    expect(slice.internalTons).toBe(12);
    expect(slice.matchingRoundIds).toEqual([1]);
    expect(slice.isPartialVisit).toBe(true);
  });

  it("slices FIRST + SECOND visit to 5t for SECOND filter", () => {
    const slice = sliceReportByGradeFilter(
      {
        rounds: [
          { id: 1, grade: "FIRST", startWeightKg: 10_000, endWeightKg: 25_000 },
          { id: 2, grade: "SECOND", startWeightKg: 25_000, endWeightKg: 30_000 },
        ],
      },
      "SECOND",
      20,
      sessions,
    );

    expect(slice.bridgeTons).toBe(5);
    expect(slice.internalTons).toBe(5);
    expect(slice.matchingRoundIds).toEqual([2]);
    expect(slice.isPartialVisit).toBe(true);
  });

  it("slices FIRST + shortbar to FIRST round tons only", () => {
    const slice = sliceReportByGradeFilter(
      {
        operationalGrade: "FIRST",
        rounds: [
          { id: 1, grade: "FIRST", startWeightKg: 10_000, endWeightKg: 25_000 },
          { id: 2, grade: null, startWeightKg: 25_000, endWeightKg: 28_000 },
        ],
      },
      "FIRST",
      18,
      sessions,
    );

    expect(slice.included).toBe(true);
    expect(slice.bridgeTons).toBe(15);
    expect(slice.internalTons).toBe(12);
    expect(slice.isPartialVisit).toBe(true);
  });

  it("marks pure single-grade visits as not partial", () => {
    const slice = sliceReportByGradeFilter(
      {
        rounds: [{ id: 1, grade: "FIRST", startWeightKg: 10_000, endWeightKg: 25_000 }],
      },
      "FIRST",
      15,
      [{ bridgeRoundId: 1, weightTons: 14, sizeId: 8 }],
    );

    expect(slice.isPartialVisit).toBe(false);
    expect(slice.bridgeTons).toBe(15);
  });
});

describe("computeRoundNetTons", () => {
  it("computes bridge net from start and end kg", () => {
    expect(
      computeRoundNetTons({
        grade: "FIRST",
        startWeightKg: 10_000,
        endWeightKg: 25_000,
      }),
    ).toBe(15);
  });
});
