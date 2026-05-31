import { describe, it, expect } from "vitest";
import {
  canShowTruckEditButton,
  effectiveOperationalGrade,
  notesForPatch,
  operationalGradeIfChanged,
} from "./truck-edit-ui";

describe("notesForPatch", () => {
  it("returns null for empty or whitespace-only notes", () => {
    expect(notesForPatch("")).toBeNull();
    expect(notesForPatch("   ")).toBeNull();
  });

  it("returns trimmed text when notes have content", () => {
    expect(notesForPatch("  ملاحظة  ")).toBe("ملاحظة");
  });
});

describe("operationalGradeIfChanged", () => {
  it("omits operationalGrade when unchanged (rebar + FIRST)", () => {
    expect(
      operationalGradeIfChanged("FIRST", true, "FIRST"),
    ).toEqual({});
  });

  it("omits when both original and form are non-rebar (null)", () => {
    expect(operationalGradeIfChanged(null, false, "")).toEqual({});
  });

  it("sends null when switching from rebar grade to non-rebar", () => {
    expect(operationalGradeIfChanged("FIRST", false, "")).toEqual({
      operationalGrade: null,
    });
  });

  it("sends grade when user selects rebar grade from null", () => {
    expect(operationalGradeIfChanged(null, true, "SECOND")).toEqual({
      operationalGrade: "SECOND",
    });
  });

  it("sends null when clearing grade while staying on rebar load", () => {
    expect(operationalGradeIfChanged("FIRST", true, "")).toEqual({
      operationalGrade: null,
    });
  });

  it("sends new grade when changing FIRST to SECOND", () => {
    expect(operationalGradeIfChanged("FIRST", true, "SECOND")).toEqual({
      operationalGrade: "SECOND",
    });
  });
});

describe("effectiveOperationalGrade", () => {
  it("returns null when not rebar or grade empty", () => {
    expect(effectiveOperationalGrade(false, "FIRST")).toBeNull();
    expect(effectiveOperationalGrade(true, "")).toBeNull();
  });

  it("returns grade when rebar and grade set", () => {
    expect(effectiveOperationalGrade(true, "FIRST")).toBe("FIRST");
  });
});

describe("canShowTruckEditButton", () => {
  it("shows for Queued with edit_queued permission", () => {
    expect(canShowTruckEditButton("Queued", 0, true, false)).toBe(true);
    expect(canShowTruckEditButton("Queued", 0, false, true)).toBe(false);
  });

  it("shows for Approved with edit_approved permission", () => {
    expect(canShowTruckEditButton("Approved", 0, false, true)).toBe(true);
    expect(canShowTruckEditButton("Approved", 2, false, true)).toBe(true);
  });

  it("shows FirstWeigh only with zero internal sessions", () => {
    expect(canShowTruckEditButton("FirstWeigh", 0, false, true)).toBe(true);
    expect(canShowTruckEditButton("FirstWeigh", 1, false, true)).toBe(false);
  });

  it("hides for OnScale and other statuses", () => {
    expect(canShowTruckEditButton("OnScale", 0, false, true)).toBe(false);
    expect(canShowTruckEditButton("Completed", 0, true, true)).toBe(false);
  });
});
