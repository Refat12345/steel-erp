import { describe, expect, it } from "vitest";

import { formatSessionSourceLabel } from "./weigh-session-source";

const labels = {
  fromProduction: "Direct from production line",
  emDash: "—",
};

describe("formatSessionSourceLabel", () => {
  it("shows production label when fromProduction is true", () => {
    expect(
      formatSessionSourceLabel(
        { fromProduction: true, sourceLocation: null },
        labels,
      ),
    ).toBe("Direct from production line");
  });

  it("prefers production even if a location is also present", () => {
    expect(
      formatSessionSourceLabel(
        {
          fromProduction: true,
          sourceLocation: {
            nameAr: "A5",
            yard: { nameAr: "Front yard" },
          },
        },
        labels,
      ),
    ).toBe("Direct from production line");
  });

  it("formats yard and location for a stock source", () => {
    expect(
      formatSessionSourceLabel(
        {
          fromProduction: false,
          sourceLocation: {
            nameAr: "A5 محافظات",
            yard: { nameAr: "الساحة الأمامية" },
          },
        },
        labels,
      ),
    ).toBe("الساحة الأمامية — A5 محافظات");
  });

  it("falls back to location name when yard is missing", () => {
    expect(
      formatSessionSourceLabel(
        {
          fromProduction: false,
          sourceLocation: { nameAr: "A5", yard: null },
        },
        labels,
      ),
    ).toBe("A5");
  });

  it("ignores blank yard names", () => {
    expect(
      formatSessionSourceLabel(
        {
          fromProduction: false,
          sourceLocation: { nameAr: "A5", yard: { nameAr: "   " } },
        },
        labels,
      ),
    ).toBe("A5");
  });

  it("shows emDash for legacy sessions with no source", () => {
    expect(
      formatSessionSourceLabel(
        { fromProduction: false, sourceLocation: null },
        labels,
      ),
    ).toBe("—");
  });
});
