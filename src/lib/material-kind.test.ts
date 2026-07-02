import { describe, expect, it } from "vitest";

import {
  inferRoundMaterialKind,
  materialKindMatchesProductFilter,
  requestSizeCodesExemptFromInternalWeighing,
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

  it("maps the billet tying wire size code", () => {
    expect(sizeCodeToKind("billet_wire_6mm")).toBe("BILLET_WIRE");
  });

  it("maps the rebar under 70 cm size code", () => {
    expect(sizeCodeToKind("rebar_under_70cm")).toBe("REBAR_UNDER_70CM");
  });

  it("maps the billet scrap 10m size code", () => {
    expect(sizeCodeToKind("billet_scrap_10m")).toBe("BILLET_SCRAP_10M");
  });

  it("maps the scrap 50 cm to 1 m size code", () => {
    expect(sizeCodeToKind("scrap_50cm_1m")).toBe("SCRAP_50CM_1M");
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

  it("matches billet wire only for BILLET_WIRE filter", () => {
    expect(materialKindMatchesProductFilter("BILLET_WIRE", "BILLET_WIRE")).toBe(true);
    expect(materialKindMatchesProductFilter("SCRAP", "BILLET_WIRE")).toBe(false);
    expect(materialKindMatchesProductFilter("BILLET_WIRE", "SCRAP")).toBe(false);
    expect(materialKindMatchesProductFilter("BILLET_WIRE", "SHORTBAR")).toBe(false);
  });

  it("matches rebar under 70 cm only for REBAR_UNDER_70CM filter", () => {
    expect(materialKindMatchesProductFilter("REBAR_UNDER_70CM", "REBAR_UNDER_70CM")).toBe(true);
    expect(materialKindMatchesProductFilter("SCRAP", "REBAR_UNDER_70CM")).toBe(false);
    expect(materialKindMatchesProductFilter("REBAR_UNDER_70CM", "SCRAP")).toBe(false);
    expect(materialKindMatchesProductFilter("REBAR_UNDER_70CM", "BILLET_WIRE")).toBe(false);
  });

  it("matches billet scrap 10m only for BILLET_SCRAP_10M filter", () => {
    expect(materialKindMatchesProductFilter("BILLET_SCRAP_10M", "BILLET_SCRAP_10M")).toBe(true);
    expect(materialKindMatchesProductFilter("SCRAP", "BILLET_SCRAP_10M")).toBe(false);
    expect(materialKindMatchesProductFilter("BILLET_SCRAP_10M", "SCRAP")).toBe(false);
    expect(materialKindMatchesProductFilter("BILLET_SCRAP_10M", "BILLET_WIRE")).toBe(false);
  });

  it("matches scrap 50 cm to 1 m only for SCRAP_50CM_1M filter", () => {
    expect(materialKindMatchesProductFilter("SCRAP_50CM_1M", "SCRAP_50CM_1M")).toBe(true);
    expect(materialKindMatchesProductFilter("SCRAP", "SCRAP_50CM_1M")).toBe(false);
    expect(materialKindMatchesProductFilter("SCRAP_50CM_1M", "SCRAP")).toBe(false);
    expect(materialKindMatchesProductFilter("SCRAP_50CM_1M", "BILLET_SCRAP_10M")).toBe(false);
  });
});

describe("requestSizeCodesExemptFromInternalWeighing", () => {
  it("exempts a single exempt size", () => {
    expect(requestSizeCodesExemptFromInternalWeighing(["scrap"])).toBe(true);
    expect(requestSizeCodesExemptFromInternalWeighing(["billet_wire_6mm"])).toBe(true);
    expect(
      requestSizeCodesExemptFromInternalWeighing(["scrap", "scrap"]),
    ).toBe(true);
  });

  it("exempts multiple distinct exempt sizes on one truck", () => {
    expect(
      requestSizeCodesExemptFromInternalWeighing(["scrap", "billet_wire_6mm"]),
    ).toBe(true);
    expect(
      requestSizeCodesExemptFromInternalWeighing([
        "scrap",
        "rebar_under_70cm",
        "scrap_50cm_1m",
      ]),
    ).toBe(true);
  });

  it("does not exempt when any size needs internal weighing", () => {
    expect(requestSizeCodesExemptFromInternalWeighing(["12"])).toBe(false);
    expect(
      requestSizeCodesExemptFromInternalWeighing(["scrap", "12"]),
    ).toBe(false);
    expect(
      requestSizeCodesExemptFromInternalWeighing(["billet_wire_6mm", "shortbar_1_4m"]),
    ).toBe(false);
  });

  it("does not exempt empty or blank size lists", () => {
    expect(requestSizeCodesExemptFromInternalWeighing([])).toBe(false);
    expect(requestSizeCodesExemptFromInternalWeighing([""])).toBe(false);
  });
});

describe("sizeCodeSupportsGrade", () => {
  it("allows grade only for rebar size codes", () => {
    expect(sizeCodeSupportsGrade("8")).toBe(true);
    expect(sizeCodeSupportsGrade("shortbar_1_4m")).toBe(false);
    expect(sizeCodeSupportsGrade("shortbar_4_12m")).toBe(false);
    expect(sizeCodeSupportsGrade("scrap")).toBe(false);
    expect(sizeCodeSupportsGrade("billet_wire_6mm")).toBe(false);
    expect(sizeCodeSupportsGrade("rebar_under_70cm")).toBe(false);
    expect(sizeCodeSupportsGrade("billet_scrap_10m")).toBe(false);
    expect(sizeCodeSupportsGrade("scrap_50cm_1m")).toBe(false);
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

  it("treats billet wire as its own product family", () => {
    expect(shouldWarnBridgeRoundProductMix(["12"], "billet_wire_6mm")).toBe(true);
    expect(shouldWarnBridgeRoundProductMix(["scrap"], "billet_wire_6mm")).toBe(true);
    expect(shouldWarnBridgeRoundProductMix(["billet_wire_6mm"], "billet_wire_6mm")).toBe(false);
  });

  it("treats rebar under 70 cm as its own product family", () => {
    expect(shouldWarnBridgeRoundProductMix(["12"], "rebar_under_70cm")).toBe(true);
    expect(shouldWarnBridgeRoundProductMix(["scrap"], "rebar_under_70cm")).toBe(true);
    expect(shouldWarnBridgeRoundProductMix(["rebar_under_70cm"], "rebar_under_70cm")).toBe(false);
  });

  it("treats billet scrap 10m as its own product family", () => {
    expect(shouldWarnBridgeRoundProductMix(["12"], "billet_scrap_10m")).toBe(true);
    expect(shouldWarnBridgeRoundProductMix(["scrap"], "billet_scrap_10m")).toBe(true);
    expect(shouldWarnBridgeRoundProductMix(["billet_scrap_10m"], "billet_scrap_10m")).toBe(false);
  });

  it("treats scrap 50 cm to 1 m as its own product family", () => {
    expect(shouldWarnBridgeRoundProductMix(["12"], "scrap_50cm_1m")).toBe(true);
    expect(shouldWarnBridgeRoundProductMix(["scrap"], "scrap_50cm_1m")).toBe(true);
    expect(shouldWarnBridgeRoundProductMix(["scrap_50cm_1m"], "scrap_50cm_1m")).toBe(false);
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
