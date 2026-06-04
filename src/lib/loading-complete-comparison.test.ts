import { describe, expect, it } from "vitest";
import { buildRequestVsLoadedComparison } from "./loading-complete-comparison";

const shortsTonsRequest = [
  {
    sizeId: 1,
    bundleCount: null,
    requestedTons: "20",
    size: { displayName: "قصائر 4-12 م", isBundleType: false },
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
