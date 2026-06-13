import { describe, expect, it } from "vitest";
import { buildRequestVsLoadedComparison } from "./loading-complete-comparison";

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
