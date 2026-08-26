import { describe, expect, it } from "vitest";
import {
  buildRequestVsLoadedComparison,
  collectFirstGradeSessions,
  evaluateFirstGradeRequestMatch,
  findFirstGradeRequestMismatches,
  shouldEnforceFirstGradeMatch,
} from "./loading-complete-comparison";

const shortsTonsRequest = [
  {
    sizeId: 1,
    bundleCount: null,
    requestedTons: "20",
    size: { displayName: "قصائر 4-12 م", isBundleType: false, code: "shortbar_4_12m" },
  },
];

describe("buildRequestVsLoadedComparison", () => {
  it("returns empty when no request items", () => {
    expect(buildRequestVsLoadedComparison([], [])).toEqual({ rows: [], warnings: [] });
  });

  it("builds comparison row for production scenario (20 طن مطلوب، 6 محمّل)", () => {
    const { rows, warnings } = buildRequestVsLoadedComparison(shortsTonsRequest, [
      {
        sizeId: 1,
        bundleCount: null,
        weightTons: "6",
        size: { displayName: "قصائر 4-12 م" },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      displayName: "قصائر 4-12 م",
      requestedLabel: "20.000 طن",
      loadedLabel: "6.000 طن",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("أقل من المطلوب");
    expect(warnings[0]).toContain("20.000 طن");
    expect(warnings[0]).toContain("6.000 طن");
  });

  it("emits no mismatch warning when loaded matches requested tons", () => {
    const { warnings } = buildRequestVsLoadedComparison(shortsTonsRequest, [
      {
        sizeId: 1,
        bundleCount: null,
        weightTons: "20",
        size: { displayName: "قصائر 4-12 م" },
      },
    ]);
    expect(warnings).toHaveLength(0);
  });

  it("warns when loaded tons exceed requested", () => {
    const { warnings } = buildRequestVsLoadedComparison(shortsTonsRequest, [
      {
        sizeId: 1,
        bundleCount: null,
        weightTons: "21",
        size: { displayName: "قصائر 4-12 م" },
      },
    ]);
    expect(warnings.some((w) => w.includes("أكثر من المطلوب"))).toBe(true);
  });

  it("sums multiple sessions per size before comparing", () => {
    const { rows, warnings } = buildRequestVsLoadedComparison(shortsTonsRequest, [
      {
        sizeId: 1,
        bundleCount: null,
        weightTons: "12",
        size: { displayName: "قصائر 4-12 م" },
      },
      {
        sizeId: 1,
        bundleCount: null,
        weightTons: "8",
        size: { displayName: "قصائر 4-12 م" },
      },
    ]);
    expect(rows[0].loadedLabel).toBe("20.000 طن");
    expect(warnings).toHaveLength(0);
  });

  it("warns when requested size has no sessions", () => {
    const { rows, warnings } = buildRequestVsLoadedComparison(shortsTonsRequest, []);
    expect(rows[0].loadedLabel).toBe("—");
    expect(warnings.some((w) => w.includes("لم يُسجَّل تحميل"))).toBe(true);
  });

  it("warns when loaded size is not in request items", () => {
    const { warnings } = buildRequestVsLoadedComparison(shortsTonsRequest, [
      {
        sizeId: 99,
        bundleCount: null,
        weightTons: "3",
        size: { displayName: "قياس إضافي" },
      },
    ]);
    expect(warnings.some((w) => w.includes("غير موجود في تفاصيل الطلبية"))).toBe(true);
  });

  it("compares bundle counts for bundle-type sizes", () => {
    const requestItems = [
      {
        sizeId: 2,
        bundleCount: 10,
        requestedTons: null,
        size: { displayName: "12مم ربطات", isBundleType: true },
      },
    ];
    const under = buildRequestVsLoadedComparison(requestItems, [
      {
        sizeId: 2,
        bundleCount: 6,
        weightTons: "5",
        size: { displayName: "12مم ربطات" },
      },
    ]);
    expect(under.rows[0].requestedLabel).toContain("ربطة");
    expect(under.rows[0].loadedLabel).toContain("ربطة");
    expect(under.warnings.some((w) => w.includes("الربطات المحمّلة أقل"))).toBe(true);

    const match = buildRequestVsLoadedComparison(requestItems, [
      {
        sizeId: 2,
        bundleCount: 10,
        weightTons: "5",
        size: { displayName: "12مم ربطات" },
      },
    ]);
    expect(match.warnings).toHaveLength(0);
  });

  describe("roundGrade filtering (multi-round)", () => {
    // 12mm requested twice — once per grade — plus a grade-less shorts line.
    const gradedRequest = [
      {
        sizeId: 1,
        grade: "FIRST" as const,
        bundleCount: 10,
        requestedTons: null,
        size: { displayName: "12مم", isBundleType: true, code: "12" },
      },
      {
        sizeId: 1,
        grade: "SECOND" as const,
        bundleCount: 4,
        requestedTons: null,
        size: { displayName: "12مم", isBundleType: true, code: "12" },
      },
      {
        sizeId: 2,
        grade: null,
        bundleCount: null,
        requestedTons: "5",
        size: { displayName: "قصائر", isBundleType: false, code: "shortbar_4_12m" },
      },
    ];

    it("undefined roundGrade → whole-operation comparison (all lines)", () => {
      const { rows } = buildRequestVsLoadedComparison(gradedRequest, []);
      expect(rows).toHaveLength(3);
    });

    it("roundGrade FIRST → only matching rebar lines (not shortbar/scrap)", () => {
      const { rows } = buildRequestVsLoadedComparison(gradedRequest, [], "FIRST");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.grade).toBe("FIRST");
      expect(rows.find((r) => r.displayName === "قصائر")).toBeUndefined();
    });

    it("roundGrade null → grade-less lines only", () => {
      const { rows } = buildRequestVsLoadedComparison(gradedRequest, [], null);
      expect(rows).toHaveLength(1);
      expect(rows[0].sizeId).toBe(2);
    });

    it("does not warn about shortbar when confirming a graded rebar round only", () => {
      const { warnings } = buildRequestVsLoadedComparison(
        gradedRequest,
        [{ sizeId: 1, bundleCount: 10, weightTons: "10", size: { displayName: "12مم" } }],
        "FIRST",
      );
      expect(warnings).toHaveLength(0);
    });

    it("does not warn about the other grade's pending line when confirming one round", () => {
      const { warnings } = buildRequestVsLoadedComparison(
        gradedRequest,
        [
          { sizeId: 1, bundleCount: 10, weightTons: "10", size: { displayName: "12مم" } },
        ],
        "FIRST",
      );
      expect(warnings).toHaveLength(0);
    });

    it("multi-round: shortbar round then FIRST round — no false shortbar warning on round 2", () => {
      const { warnings } = buildRequestVsLoadedComparison(
        gradedRequest,
        [{ sizeId: 1, bundleCount: 10, weightTons: "10", size: { displayName: "12مم" } }],
        "FIRST",
      );
      expect(warnings.some((w) => w.includes("قصائر"))).toBe(false);
    });
  });

  it("handles multiple request lines independently", () => {
    const requestItems = [
      {
        sizeId: 1,
        bundleCount: null,
        requestedTons: "10",
        size: { displayName: "أ", isBundleType: false },
      },
      {
        sizeId: 2,
        bundleCount: null,
        requestedTons: "5",
        size: { displayName: "ب", isBundleType: false },
      },
    ];
    const { rows, warnings } = buildRequestVsLoadedComparison(requestItems, [
      { sizeId: 1, bundleCount: null, weightTons: "10", size: { displayName: "أ" } },
      { sizeId: 2, bundleCount: null, weightTons: "2", size: { displayName: "ب" } },
    ]);
    expect(rows).toHaveLength(2);
    expect(warnings.filter((w) => w.includes("«ب»"))).toHaveLength(1);
    expect(warnings.filter((w) => w.includes("«أ»"))).toHaveLength(0);
  });
});

describe("shouldEnforceFirstGradeMatch", () => {
  const firstLine = {
    sizeId: 1,
    grade: "FIRST" as const,
    bundleCount: 10,
    requestedTons: null,
    size: { displayName: "12مم", isBundleType: true, code: "12" },
  };
  const secondLine = {
    sizeId: 1,
    grade: "SECOND" as const,
    bundleCount: 4,
    requestedTons: null,
    size: { displayName: "12مم", isBundleType: true, code: "12" },
  };

  it("does not enforce when there are no first-grade request lines", () => {
    expect(shouldEnforceFirstGradeMatch([], "FIRST")).toBe(false);
    expect(shouldEnforceFirstGradeMatch([secondLine], "FIRST")).toBe(false);
  });

  it("always enforces a pure first-grade truck, even if the dialog picks SECOND", () => {
    expect(shouldEnforceFirstGradeMatch([firstLine], "FIRST")).toBe(true);
    expect(shouldEnforceFirstGradeMatch([firstLine], "SECOND")).toBe(true);
    expect(shouldEnforceFirstGradeMatch([firstLine], null)).toBe(true);
  });

  it("enforces a mixed truck only on the FIRST round", () => {
    expect(shouldEnforceFirstGradeMatch([firstLine, secondLine], "FIRST")).toBe(true);
    expect(shouldEnforceFirstGradeMatch([firstLine, secondLine], "SECOND")).toBe(false);
    expect(shouldEnforceFirstGradeMatch([firstLine, secondLine], null)).toBe(false);
  });
});

describe("findFirstGradeRequestMismatches", () => {
  const b500 = { displayName: "B500B" };
  const b400 = { displayName: "B400DWR" };
  const size12 = { displayName: "12مم", isBundleType: true, code: "12" };

  it("returns empty when loaded matches a classified request exactly", () => {
    const issues = findFirstGradeRequestMismatches(
      [
        {
          sizeId: 1,
          grade: "FIRST",
          classificationId: 10,
          classification: b500,
          bundleCount: 10,
          requestedTons: null,
          size: size12,
        },
      ],
      [
        {
          sizeId: 1,
          classificationId: 10,
          classification: b500,
          bundleCount: 10,
          weightTons: "8",
          size: size12,
        },
      ],
    );
    expect(issues).toEqual([]);
  });

  it("treats a short classified load as a remainder, not a blocking error", () => {
    const result = evaluateFirstGradeRequestMatch(
      [
        {
          sizeId: 1,
          grade: "FIRST",
          classificationId: 10,
          classification: b500,
          bundleCount: 10,
          requestedTons: null,
          size: size12,
        },
      ],
      [
        {
          sizeId: 1,
          classificationId: 10,
          classification: b500,
          bundleCount: 6,
          weightTons: "5",
          size: size12,
        },
      ],
    );
    expect(result.blocking).toEqual([]);
    expect(result.remainders).toHaveLength(1);
    expect(result.remainders[0].params.remaining).toContain("4");
  });

  it("blocks when cumulative load exceeds the request", () => {
    const issues = findFirstGradeRequestMismatches(
      [
        {
          sizeId: 1,
          grade: "FIRST",
          classificationId: 10,
          classification: b500,
          bundleCount: 10,
          requestedTons: null,
          size: size12,
        },
      ],
      [
        {
          sizeId: 1,
          classificationId: 10,
          classification: b500,
          bundleCount: 12,
          weightTons: "9",
          size: size12,
        },
      ],
    );
    expect(issues.map((i) => i.messageKey)).toContain("firstGradeLoadedNotInRequest");
  });

  it("treats two partial rounds that sum to the request as a match", () => {
    const result = evaluateFirstGradeRequestMatch(
      [
        {
          sizeId: 1,
          grade: "FIRST",
          classificationId: 10,
          classification: b500,
          bundleCount: 20,
          requestedTons: null,
          size: size12,
        },
      ],
      [
        {
          sizeId: 1,
          classificationId: 10,
          classification: b500,
          bundleCount: 10,
          weightTons: "8",
          size: size12,
        },
        {
          sizeId: 1,
          classificationId: 10,
          classification: b500,
          bundleCount: 10,
          weightTons: "8",
          size: size12,
        },
      ],
    );
    expect(result.blocking).toEqual([]);
    expect(result.remainders).toEqual([]);
  });

  it("rejects swapping B500B and B400DWR even when size totals match", () => {
    const issues = findFirstGradeRequestMismatches(
      [
        {
          sizeId: 1,
          grade: "FIRST",
          classificationId: 10,
          classification: b500,
          bundleCount: 10,
          requestedTons: null,
          size: size12,
        },
        {
          sizeId: 1,
          grade: "FIRST",
          classificationId: 20,
          classification: b400,
          bundleCount: 5,
          requestedTons: null,
          size: size12,
        },
      ],
      [
        {
          sizeId: 1,
          classificationId: 10,
          classification: b500,
          bundleCount: 5,
          weightTons: "4",
          size: size12,
        },
        {
          sizeId: 1,
          classificationId: 20,
          classification: b400,
          bundleCount: 10,
          weightTons: "8",
          size: size12,
        },
      ],
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.params.sizeLabel.includes("B400DWR"))).toBe(true);
  });

  it("lets leftover classified quantity cover an unclassified request remainder", () => {
    const issues = findFirstGradeRequestMismatches(
      [
        {
          sizeId: 1,
          grade: "FIRST",
          classificationId: 10,
          classification: b500,
          bundleCount: 10,
          requestedTons: null,
          size: size12,
        },
        {
          sizeId: 1,
          grade: "FIRST",
          classificationId: null,
          bundleCount: 5,
          requestedTons: null,
          size: size12,
        },
      ],
      [
        {
          sizeId: 1,
          classificationId: 10,
          classification: b500,
          bundleCount: 15,
          weightTons: "12",
          size: size12,
        },
      ],
    );
    expect(issues).toEqual([]);
  });

  it("accepts any classification when the request line is unclassified", () => {
    const issues = findFirstGradeRequestMismatches(
      [
        {
          sizeId: 1,
          grade: "FIRST",
          classificationId: null,
          bundleCount: 15,
          requestedTons: null,
          size: size12,
        },
      ],
      [
        {
          sizeId: 1,
          classificationId: 10,
          classification: b500,
          bundleCount: 10,
          weightTons: "8",
          size: size12,
        },
        {
          sizeId: 1,
          classificationId: 20,
          classification: b400,
          bundleCount: 5,
          weightTons: "4",
          size: size12,
        },
      ],
    );
    expect(issues).toEqual([]);
  });

  it("rejects unclassified sessions when every request line is classified", () => {
    const issues = findFirstGradeRequestMismatches(
      [
        {
          sizeId: 1,
          grade: "FIRST",
          classificationId: 10,
          classification: b500,
          bundleCount: 10,
          requestedTons: null,
          size: size12,
        },
      ],
      [
        {
          sizeId: 1,
          classificationId: 10,
          classification: b500,
          bundleCount: 10,
          weightTons: "8",
          size: size12,
        },
        {
          sizeId: 1,
          classificationId: null,
          bundleCount: 2,
          weightTons: "1",
          size: size12,
        },
      ],
    );
    expect(issues.map((i) => i.messageKey)).toContain("firstGradeLoadedNotInRequest");
  });

  it("rejects a loaded size that is not on the first-grade request", () => {
    const issues = findFirstGradeRequestMismatches(
      [
        {
          sizeId: 1,
          grade: "FIRST",
          classificationId: null,
          bundleCount: 10,
          requestedTons: null,
          size: size12,
        },
      ],
      [
        {
          sizeId: 1,
          classificationId: null,
          bundleCount: 10,
          weightTons: "8",
          size: size12,
        },
        {
          sizeId: 2,
          classificationId: null,
          bundleCount: 3,
          weightTons: "2",
          size: { displayName: "16مم", isBundleType: true, code: "16" },
        },
      ],
    );
    expect(issues.map((i) => i.messageKey)).toContain("firstGradeLoadedNotInRequest");
  });

  it("ignores second-grade request lines", () => {
    const issues = findFirstGradeRequestMismatches(
      [
        {
          sizeId: 1,
          grade: "SECOND",
          bundleCount: 20,
          requestedTons: null,
          size: size12,
        },
      ],
      [],
    );
    expect(issues).toEqual([]);
  });
});

describe("collectFirstGradeSessions", () => {
  it("includes prior FIRST rounds and the current open round", () => {
    const sessions = [
      { id: 1, bridgeRoundId: 10 },
      { id: 2, bridgeRoundId: 11 },
      { id: 3, bridgeRoundId: 12 },
    ];
    const rounds = [
      { id: 10, grade: "FIRST" as const },
      { id: 11, grade: "SECOND" as const },
      { id: 12, grade: null },
    ];
    expect(collectFirstGradeSessions(sessions, rounds, 12).map((s) => s.id)).toEqual([
      1, 3,
    ]);
  });
});
