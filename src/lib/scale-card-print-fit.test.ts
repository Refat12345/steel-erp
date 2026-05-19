import { describe, expect, it } from "vitest";
import { computeA4PrintFitScale, mmToCssPx } from "./scale-card-print-fit";

describe("computeA4PrintFitScale", () => {
  it("returns 1 when content fits", () => {
    expect(computeA4PrintFitScale(100, 100)).toBe(1);
  });

  it("shrinks when content exceeds printable height", () => {
    const maxH = mmToCssPx(285);
    const scale = computeA4PrintFitScale(400, maxH * 2);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeCloseTo(0.5, 1);
  });

  it("scales down without a floor for very tall content", () => {
    const scale = computeA4PrintFitScale(10_000, 10_000);
    expect(scale).toBeLessThan(0.2);
  });
});
