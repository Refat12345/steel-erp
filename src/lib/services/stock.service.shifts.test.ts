/**
 * Operational day & work-shift attribution for production entries.
 *
 * Pins:
 *  - Two shifts only: MORNING 08:00–20:00, EVENING 20:00–08:00.
 *  - The grace window is one full hour after each boundary (08:00 / 20:00),
 *    during which a clerk may attribute the entry to the shift that just ended.
 *  - An 08:0x entry attributed to EVENING lands on the PREVIOUS operational day.
 */
import { describe, it, expect } from "vitest";
import {
  DAY_START_HOUR,
  SHIFT_GRACE_MINUTES,
  naturalShift,
  inShiftGraceWindow,
  operationalDayStart,
  belongsToPreviousOperationalDay,
} from "./stock.service";
import {
  SHIFT_GRACE_MINUTES as CLIENT_GRACE_MINUTES,
  naturalShiftOf,
  inShiftGraceWindow as clientInShiftGraceWindow,
  previousShiftOf,
} from "@/components/stock/stock-shared";

/** Local wall-clock date — shift logic is deliberately server-clock based. */
function at(hour: number, minute = 0, day = 15): Date {
  return new Date(2026, 8, day, hour, minute, 0, 0);
}

describe("naturalShift", () => {
  it("treats 08:00–19:59 as MORNING", () => {
    expect(naturalShift(at(8, 0))).toBe("MORNING");
    expect(naturalShift(at(13, 30))).toBe("MORNING");
    expect(naturalShift(at(19, 59))).toBe("MORNING");
  });

  it("treats 20:00–07:59 as EVENING", () => {
    expect(naturalShift(at(20, 0))).toBe("EVENING");
    expect(naturalShift(at(23, 59))).toBe("EVENING");
    expect(naturalShift(at(0, 5))).toBe("EVENING");
    expect(naturalShift(at(7, 59))).toBe("EVENING");
  });
});

describe("inShiftGraceWindow", () => {
  it("is a full hour long", () => {
    expect(SHIFT_GRACE_MINUTES).toBe(60);
  });

  it("covers the whole hour after each boundary", () => {
    for (const boundary of [8, 20]) {
      expect(inShiftGraceWindow(at(boundary, 0))).toBe(true);
      expect(inShiftGraceWindow(at(boundary, 30))).toBe(true);
      expect(inShiftGraceWindow(at(boundary, 59))).toBe(true);
    }
  });

  it("closes once the hour has elapsed", () => {
    expect(inShiftGraceWindow(at(9, 0))).toBe(false);
    expect(inShiftGraceWindow(at(21, 0))).toBe(false);
    expect(inShiftGraceWindow(at(13, 0))).toBe(false);
    expect(inShiftGraceWindow(at(7, 59))).toBe(false);
    expect(inShiftGraceWindow(at(19, 59))).toBe(false);
  });
});

describe("client mirror stays in sync with the server", () => {
  it("uses the same grace length", () => {
    expect(CLIENT_GRACE_MINUTES).toBe(SHIFT_GRACE_MINUTES);
  });

  it("resolves the same shift and grace window across the clock", () => {
    for (let hour = 0; hour < 24; hour++) {
      for (const minute of [0, 1, 30, 59]) {
        const d = at(hour, minute);
        expect(naturalShiftOf(d)).toBe(naturalShift(d));
        expect(clientInShiftGraceWindow(d)).toBe(inShiftGraceWindow(d));
      }
    }
  });

  it("pairs the two shifts as each other's previous", () => {
    expect(previousShiftOf("MORNING")).toBe("EVENING");
    expect(previousShiftOf("EVENING")).toBe("MORNING");
  });
});

describe("operationalDayStart", () => {
  it("starts at 08:00, not midnight", () => {
    expect(DAY_START_HOUR).toBe(8);
    expect(operationalDayStart(at(13, 0))).toEqual(at(8, 0));
    expect(operationalDayStart(at(8, 0))).toEqual(at(8, 0));
    expect(operationalDayStart(at(23, 45))).toEqual(at(8, 0));
  });

  it("rolls back to yesterday before 08:00", () => {
    expect(operationalDayStart(at(3, 15))).toEqual(at(8, 0, 14));
    expect(operationalDayStart(at(7, 59))).toEqual(at(8, 0, 14));
  });
});

describe("belongsToPreviousOperationalDay", () => {
  it("moves a morning-grace entry attributed to EVENING back a day", () => {
    expect(belongsToPreviousOperationalDay(at(8, 20), "EVENING")).toBe(true);
  });

  it("keeps the 20:00 override inside the same operational day", () => {
    expect(belongsToPreviousOperationalDay(at(20, 20), "MORNING")).toBe(false);
  });

  it("keeps entries recorded in their natural shift", () => {
    expect(belongsToPreviousOperationalDay(at(8, 20), "MORNING")).toBe(false);
    expect(belongsToPreviousOperationalDay(at(23, 0), "EVENING")).toBe(false);
    expect(belongsToPreviousOperationalDay(at(13, 0), null)).toBe(false);
  });
});
