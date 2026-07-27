import { describe, it, expect } from "vitest";
import {
  computeBridgeTons,
  computeDiscrepancyTons,
  computeInternalTons,
  defaultOperationalDateInput,
  getOperationalDayWindow,
  parseOperationalDateInput,
  resolveOperationalListDate,
  resolveReportTonnageStatus,
} from "./operational-day";

describe("parseOperationalDateInput", () => {
  it("parses valid YYYY-MM-DD", () => {
    expect(parseOperationalDateInput("2026-05-23")).toEqual({
      year: 2026,
      month: 5,
      day: 23,
    });
  });

  it("rejects invalid calendar dates", () => {
    expect(() => parseOperationalDateInput("2026-02-30")).toThrow(
      "INVALID_OPERATIONAL_DATE",
    );
  });
});

describe("getOperationalDayWindow", () => {
  it("builds 08:00 → next day 08:00 local window", () => {
    const w = getOperationalDayWindow("2026-05-23");
    expect(w.from).toEqual(new Date(2026, 4, 23, 8, 0, 0, 0));
    expect(w.to).toEqual(new Date(2026, 4, 24, 8, 0, 0, 0));
  });
});

describe("resolveReportTonnageStatus", () => {
  const window = getOperationalDayWindow("2026-05-23");

  it("includes completed truck closed before window end", () => {
    expect(
      resolveReportTonnageStatus({
        status: "Completed",
        closedAt: new Date(2026, 4, 24, 7, 59, 0, 0),
        window,
      }),
    ).toBe("included");
  });

  it("excludes completed truck closed at or after window end", () => {
    expect(
      resolveReportTonnageStatus({
        status: "Completed",
        closedAt: new Date(2026, 4, 24, 8, 0, 0, 0),
        window,
      }),
    ).toBe("excluded_late_close");
  });

  it("excludes cancelled trucks", () => {
    expect(
      resolveReportTonnageStatus({
        status: "Cancelled",
        closedAt: new Date(2026, 4, 23, 12, 0, 0, 0),
        window,
      }),
    ).toBe("excluded_cancelled");
  });

  it("excludes open trucks", () => {
    expect(
      resolveReportTonnageStatus({
        status: "OnScale",
        closedAt: null,
        window,
      }),
    ).toBe("excluded_open");
  });
});

describe("weight helpers", () => {
  it("computes bridge tons from kg pair", () => {
    expect(computeBridgeTons(25_000, 10_000)).toBe(15);
  });

  it("sums internal session tons", () => {
    expect(
      computeInternalTons([{ weightTons: 5 }, { weightTons: "4.5" }]),
    ).toBe(9.5);
  });

  it("computes signed discrepancy", () => {
    expect(computeDiscrepancyTons(15, 14.5)).toBe(0.5);
  });
});

describe("defaultOperationalDateInput", () => {
  it("returns previous calendar day before cutoff hour", () => {
    const now = new Date(2026, 4, 24, 6, 30, 0, 0);
    expect(defaultOperationalDateInput(now)).toBe("2026-05-23");
  });

  it("returns same calendar day at or after cutoff hour", () => {
    const now = new Date(2026, 4, 24, 9, 0, 0, 0);
    expect(defaultOperationalDateInput(now)).toBe("2026-05-24");
  });
});

describe("resolveOperationalListDate", () => {
  const now = new Date(2026, 4, 24, 10, 0, 0, 0); // today = 2026-05-24

  it("forces today when history is not allowed and date is omitted", () => {
    expect(resolveOperationalListDate(null, false, now)).toEqual({
      ok: true,
      date: "2026-05-24",
    });
  });

  it("allows today when history is not allowed", () => {
    expect(resolveOperationalListDate("2026-05-24", false, now)).toEqual({
      ok: true,
      date: "2026-05-24",
    });
  });

  it("rejects a past date when history is not allowed", () => {
    expect(resolveOperationalListDate("2026-05-20", false, now)).toEqual({
      ok: false,
      reason: "historyForbidden",
    });
  });

  it("allows any valid date when history is allowed", () => {
    expect(resolveOperationalListDate("2026-05-20", true, now)).toEqual({
      ok: true,
      date: "2026-05-20",
    });
  });

  it("returns null date (no filter) when history is allowed and date omitted", () => {
    expect(resolveOperationalListDate(null, true, now)).toEqual({
      ok: true,
      date: null,
    });
  });

  it("rejects invalid dates", () => {
    expect(resolveOperationalListDate("not-a-date", false, now)).toEqual({
      ok: false,
      reason: "invalidOperationalDate",
    });
  });

  it("uses previous calendar day as today before the 08:00 cutoff", () => {
    const beforeCutoff = new Date(2026, 4, 24, 7, 0, 0, 0); // today = 2026-05-23
    expect(resolveOperationalListDate("2026-05-23", false, beforeCutoff)).toEqual({
      ok: true,
      date: "2026-05-23",
    });
    expect(resolveOperationalListDate("2026-05-24", false, beforeCutoff)).toEqual({
      ok: false,
      reason: "historyForbidden",
    });
  });

  it("rejects a future operational date without history permission", () => {
    expect(resolveOperationalListDate("2026-05-25", false, now)).toEqual({
      ok: false,
      reason: "historyForbidden",
    });
  });
});
