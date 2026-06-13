import { describe, expect, it } from "vitest";

import {
  inferRoundMaterialKind,
  materialKindMatchesProductFilter,
  sessionMatchesProductFilter,
  sizeCodeSupportsGrade,
  shouldWarnBridgeRoundProductMix,
  sizeCodeToKind,
} from "./material-kind";

describe("sizeCodeToKind", () => {
  it("maps shortbar and scrap size codes", () => {
    expect(sizeCodeToKind("shortbar_1_4m")).toBe("SHORTBAR_1_4M");
    expect(sizeCodeToKind("shortbar_4_12m")).toBe("SHORTBAR_4_12M");
    expect(sizeCodeToKind("scrap")).toBe("SCRAP");
    expect(sizeCodeToKind("8")).toBe("REBAR");
  });
});

describe("inferRoundMaterialKind", () => {
  it("picks dominant kind by session tons", () => {
    const kind = inferRoundMaterialKind(2, [
      {
        bridgeRoundId: 2,
        weightTons: 1,
        size: { code: "shortbar_1_4m" },
      },
      {
        bridgeRoundId: 2,
        weightTons: 4,
        size: { code: "shortbar_4_12m" },
      },
    ]);
    expect(kind).toBe("SHORTBAR_4_12M");
  });
});

describe("materialKindMatchesProductFilter", () => {
  it("combines both shortbar kinds under SHORTBAR filter", () => {
    expect(materialKindMatchesProductFilter("SHORTBAR_1_4M", "SHORTBAR")).toBe(true);
    expect(materialKindMatchesProductFilter("SHORTBAR_4_12M", "SHORTBAR")).toBe(true);
    expect(materialKindMatchesProductFilter("SCRAP", "SHORTBAR")).toBe(false);
  });

  it("matches scrap only for SCRAP filter", () => {
    expect(materialKindMatchesProductFilter("SCRAP", "SCRAP")).toBe(true);
    expect(materialKindMatchesProductFilter("SHORTBAR_1_4M", "SCRAP")).toBe(false);
  });
});

describe("sizeCodeSupportsGrade", () => {
  it("allows grade only for rebar size codes", () => {
    expect(sizeCodeSupportsGrade("8")).toBe(true);
    expect(sizeCodeSupportsGrade("shortbar_1_4m")).toBe(false);
    expect(sizeCodeSupportsGrade("shortbar_4_12m")).toBe(false);
    expect(sizeCodeSupportsGrade("scrap")).toBe(false);
    expect(sizeCodeSupportsGrade("")).toBe(true);
  });
});

describe("shouldWarnBridgeRoundProductMix", () => {
  it("does not warn when adding another rebar size to rebar-only round", () => {
    expect(shouldWarnBridgeRoundProductMix(["12", "8"], "10")).toBe(false);
  });

  it("does not warn when adding another shortbar code to shortbar-only round", () => {
    expect(
      shouldWarnBridgeRoundProductMix(["shortbar_1_4m"], "shortbar_4_12m"),
    ).toBe(false);
  });

  it("warns when mixing rebar with shortbar in the same round", () => {
    expect(shouldWarnBridgeRoundProductMix(["12"], "shortbar_1_4m")).toBe(true);
    expect(shouldWarnBridgeRoundProductMix(["shortbar_4_12m"], "8")).toBe(true);
  });

  it("warns when mixing rebar with scrap in the same round", () => {
    expect(shouldWarnBridgeRoundProductMix(["scrap"], "12")).toBe(true);
  });
});

describe("sessionMatchesProductFilter", () => {
  it("includes rebar sessions for grade filters only", () => {
    expect(
      sessionMatchesProductFilter(
        { weightTons: 5, size: { code: "12" } },
        "FIRST",
      ),
    ).toBe(true);
    expect(
      sessionMatchesProductFilter(
        { weightTons: 5, size: { code: "shortbar_1_4m" } },
        "FIRST",
      ),
    ).toBe(false);
  });

  it("includes both shortbar size codes for SHORTBAR filter", () => {
    expect(
      sessionMatchesProductFilter(
        { weightTons: 5, size: { code: "shortbar_1_4m" } },
        "SHORTBAR",
      ),
    ).toBe(true);
    expect(
      sessionMatchesProductFilter(
        { weightTons: 5, size: { code: "shortbar_4_12m" } },
        "SHORTBAR",
      ),
    ).toBe(true);
  });
});
