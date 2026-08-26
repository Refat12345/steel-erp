import { describe, expect, it } from "vitest";
import {
  classificationIdFromSelect,
  classificationSelectValue,
  defaultClassificationId,
  isSizeSelectableOnRequestLine,
  offeredSteelClassifications,
  resolveClassificationId,
  unusedClassificationId,
  NO_CLASSIFICATION_SELECT_VALUE,
} from "./steel-classification-default";

const catalog = [
  { id: 1, code: "B500B", grade: "FIRST" },
];

describe("classificationSelectValue", () => {
  it("maps empty to the none sentinel so the trigger shows no-classification", () => {
    expect(classificationSelectValue("")).toBe(NO_CLASSIFICATION_SELECT_VALUE);
    expect(classificationSelectValue(null)).toBe(NO_CLASSIFICATION_SELECT_VALUE);
    expect(classificationSelectValue("1")).toBe("1");
  });

  it("maps the none sentinel back to empty for the payload", () => {
    expect(classificationIdFromSelect(NO_CLASSIFICATION_SELECT_VALUE)).toBe("");
    expect(classificationIdFromSelect("")).toBe("");
    expect(classificationIdFromSelect("1")).toBe("1");
  });
});

describe("offeredSteelClassifications", () => {
  it("hides retired B400DWR even if the catalog still returns it", () => {
    expect(
      offeredSteelClassifications([
        { id: 1, code: "B500B" },
        { id: 2, code: "B400DWR" },
      ]),
    ).toEqual([{ id: 1, code: "B500B" }]);
  });
});

describe("defaultClassificationId", () => {
  it("leaves new lines unclassified", () => {
    expect(defaultClassificationId(catalog, "FIRST")).toBe("");
    expect(defaultClassificationId(catalog, "SECOND")).toBe("");
    expect(defaultClassificationId()).toBe("");
  });
});

describe("resolveClassificationId", () => {
  it("keeps a valid current classification from the offered catalog", () => {
    expect(
      resolveClassificationId({
        current: "1",
        nextGrade: "FIRST",
        classifications: catalog,
      }),
    ).toBe("1");
  });

  it("clears when the current classification does not match the grade", () => {
    expect(
      resolveClassificationId({
        current: "1",
        nextGrade: "SECOND",
        classifications: catalog,
      }),
    ).toBe("");
  });

  it("clears historical codes that are no longer offered", () => {
    expect(
      resolveClassificationId({
        current: "2",
        nextGrade: "FIRST",
        classifications: catalog,
        applyDefaultIfEmpty: true,
      }),
    ).toBe("");
  });

  it("does not invent a default when empty", () => {
    expect(
      resolveClassificationId({
        current: "",
        nextGrade: "FIRST",
        classifications: catalog,
        applyDefaultIfEmpty: true,
      }),
    ).toBe("");
  });
});

describe("isSizeSelectableOnRequestLine", () => {
  const offeredFirst = ["", "1"];

  it("keeps 16mm available when only unclassified 16mm FIRST is taken", () => {
    expect(
      isSizeSelectableOnRequestLine({
        sizeCode: "16",
        rowSizeCode: "",
        rowGrade: "FIRST",
        otherLines: [{ sizeCode: "16", grade: "FIRST", classificationId: "" }],
        offeredClassificationIds: offeredFirst,
      }),
    ).toBe(true);
  });

  it("hides 16mm when unclassified and B500B are both taken", () => {
    expect(
      isSizeSelectableOnRequestLine({
        sizeCode: "16",
        rowSizeCode: "",
        rowGrade: "FIRST",
        otherLines: [
          { sizeCode: "16", grade: "FIRST", classificationId: "" },
          { sizeCode: "16", grade: "FIRST", classificationId: "1" },
        ],
        offeredClassificationIds: offeredFirst,
      }),
    ).toBe(false);
  });

  it("always shows the size already on this row", () => {
    expect(
      isSizeSelectableOnRequestLine({
        sizeCode: "16",
        rowSizeCode: "16",
        rowGrade: "FIRST",
        otherLines: [
          { sizeCode: "16", grade: "FIRST", classificationId: "" },
          { sizeCode: "16", grade: "FIRST", classificationId: "1" },
        ],
        offeredClassificationIds: offeredFirst,
      }),
    ).toBe(true);
  });
});

describe("unusedClassificationId", () => {
  it("switches to B500B when unclassified 16mm is already on another line", () => {
    expect(
      unusedClassificationId({
        current: "",
        usedByOthers: new Set([""]),
        offeredClassificationIds: ["", "1"],
      }),
    ).toBe("1");
  });

  it("keeps unclassified when that slot is still free", () => {
    expect(
      unusedClassificationId({
        current: "",
        usedByOthers: new Set(),
        offeredClassificationIds: ["", "1"],
      }),
    ).toBe("");
  });
});
