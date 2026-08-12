/**
 * Hourly-breakdown derivation tests.
 *
 * The PLC's own hourly registers stay at zero for the hours after midnight, so
 * the board derives every hour from how much the running total grew. These
 * tests pin the attribution rules: hour boundaries, the 08:00 counter reset,
 * missing telemetry, and a manual RESET COUNTER press.
 */
import { describe, it, expect } from "vitest";

import { computeHourlyFromSamples } from "./mill-live.service";

const HOUR_MS = 60 * 60 * 1000;

/** Operational day start: 08:00 local. */
const WINDOW_START = new Date(2026, 7, 11, 8, 0, 0, 0).getTime();

function at(hoursFromStart: number, minutes = 0): number {
  return WINDOW_START + hoursFromStart * HOUR_MS + minutes * 60 * 1000;
}

describe("computeHourlyFromSamples", () => {
  it("returns all zeros and flags elapsed hours when there is no telemetry", () => {
    const result = computeHourlyFromSamples([], WINDOW_START, at(3));

    expect(result.hourlyBreakdown).toEqual(new Array(24).fill(0));
    expect(result.incompleteHours).toEqual([0, 1, 2, 3]);
  });

  it("credits growth of the running total to the hour it happened in", () => {
    const samples = [
      { at: at(1, 0), total: 58 },
      { at: at(2, 0), total: 102 },
      { at: at(3, 0), total: 145 },
    ];

    const result = computeHourlyFromSamples(samples, WINDOW_START, at(3, 1));

    expect(result.hourlyBreakdown.slice(0, 4)).toEqual([58, 44, 43, 0]);
    expect(result.incompleteHours).toEqual([]);
  });

  it("splits a normal short interval across the hour it crosses, unflagged", () => {
    // Readings a minute either side of 09:00 with 4 billets between them.
    const samples = [
      { at: at(0, 59), total: 58 },
      { at: at(1, 1), total: 62 },
    ];

    const result = computeHourlyFromSamples(samples, WINDOW_START, at(1, 2));

    expect(result.hourlyBreakdown[0]).toBe(60);
    expect(result.hourlyBreakdown[1]).toBe(2);
    expect(result.incompleteHours).toEqual([]);
  });

  it("counts the first reading as production since the 08:00 reset", () => {
    // Counter resets at the cutoff, so a reading of 12 at 08:30 means 12 were
    // made after 08:00 - no earlier baseline is needed.
    const samples = [{ at: at(0, 30), total: 12 }];

    const result = computeHourlyFromSamples(samples, WINDOW_START, at(0, 31));

    expect(result.hourlyBreakdown[0]).toBe(12);
    expect(result.incompleteHours).toEqual([]);
  });

  it("keeps counting correctly across midnight", () => {
    // Slots 16..19 are 00:00 through 04:00 - exactly where the PLC array fails.
    const samples = [
      { at: at(16, 0), total: 900 },
      { at: at(17, 0), total: 938 },
      { at: at(18, 0), total: 979 },
      { at: at(19, 0), total: 1049 },
    ];

    const result = computeHourlyFromSamples(samples, WINDOW_START, at(19, 1));

    expect(result.hourlyBreakdown[16]).toBe(38);
    expect(result.hourlyBreakdown[17]).toBe(41);
    expect(result.hourlyBreakdown[18]).toBe(70);
  });

  it("splits an interval that straddles an hour boundary", () => {
    // 30 minutes either side of 09:00, 60 billets -> 30 to each hour.
    const samples = [
      { at: at(0, 30), total: 0 },
      { at: at(1, 30), total: 60 },
    ];

    const result = computeHourlyFromSamples(samples, WINDOW_START, at(1, 31));

    expect(result.hourlyBreakdown[0]).toBe(30);
    expect(result.hourlyBreakdown[1]).toBe(30);
  });

  it("flags hours the collector missed and spreads the catch-up delta", () => {
    // Down from 09:00 to 12:00, then reports 300 more billets.
    const samples = [
      { at: at(1, 0), total: 100 },
      { at: at(4, 0), total: 400 },
    ];

    const result = computeHourlyFromSamples(samples, WINDOW_START, at(4, 1));

    // 08:00-09:00 is exact: the reset means 100 were made in that hour.
    expect(result.hourlyBreakdown[0]).toBe(100);
    expect(result.incompleteHours).toEqual([1, 2, 3]);
    expect(result.hourlyBreakdown[1]).toBe(100);
    expect(result.hourlyBreakdown[2]).toBe(100);
    expect(result.hourlyBreakdown[3]).toBe(100);
  });

  it("spreads a late start over the hours it covers rather than dropping it", () => {
    const samples = [
      { at: at(3, 0), total: 500 },
      { at: at(4, 0), total: 560 },
    ];

    const result = computeHourlyFromSamples(samples, WINDOW_START, at(4, 1));

    expect(result.incompleteHours).toEqual([0, 1, 2]);
    // The 500 are real production, just not attributable hour by hour.
    expect(result.hourlyBreakdown.slice(0, 3)).toEqual([167, 167, 167]);
    expect(result.hourlyBreakdown[3]).toBe(60);
  });

  it("survives a RESET COUNTER press without producing negatives", () => {
    const samples = [
      { at: at(0, 30), total: 40 },
      { at: at(1, 30), total: 5 },
      { at: at(2, 30), total: 25 },
    ];

    const result = computeHourlyFromSamples(samples, WINDOW_START, at(2, 31));

    expect(result.hourlyBreakdown.every((count) => count >= 0)).toBe(true);
    expect(result.incompleteHours).toContain(1);
    // The 20 counted after the reset are still credited.
    expect(result.hourlyBreakdown[1] + result.hourlyBreakdown[2]).toBeGreaterThan(0);
  });

  it("flags the hours after the collector went silent", () => {
    const samples = [{ at: at(0, 30), total: 40 }];

    const result = computeHourlyFromSamples(samples, WINDOW_START, at(3, 0));

    expect(result.incompleteHours).toEqual([0, 1, 2, 3]);
  });

  it("does not flag hours that have not happened yet", () => {
    const samples = [
      { at: at(0, 30), total: 10 },
      { at: at(0, 59), total: 20 },
    ];

    const result = computeHourlyFromSamples(samples, WINDOW_START, at(1, 0));

    expect(result.incompleteHours).toEqual([]);
    expect(result.hourlyBreakdown.slice(2)).toEqual(new Array(22).fill(0));
  });

  it("always returns 24 slots", () => {
    const result = computeHourlyFromSamples(
      [{ at: at(5, 0), total: 1 }],
      WINDOW_START,
      at(5, 1),
    );

    expect(result.hourlyBreakdown).toHaveLength(24);
  });
});
