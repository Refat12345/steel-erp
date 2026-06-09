import { describe, expect, it } from "vitest";
import {
  computeA4LandscapePrintFitScale,
  computeA4PrintFitScale,
  mmToCssPx,
} from "./scale-card-print-fit";

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

describe("computeA4LandscapePrintFitScale", () => {
  it("returns 1 when content fits", () => {
    expect(computeA4LandscapePrintFitScale(100, 100)).toBe(1);
  });

  it("shrinks when content exceeds landscape printable height", () => {
    const maxH = mmToCssPx(190);
    const scale = computeA4LandscapePrintFitScale(400, maxH * 2);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeCloseTo(0.5, 1);
  });

  it("is bound by width when content is wider than landscape printable area", () => {
    const maxW = mmToCssPx(277);
    const scale = computeA4LandscapePrintFitScale(maxW * 4, 100);
    expect(scale).toBeCloseTo(0.25, 1);
  });

  it("never returns a scale above 1", () => {
    expect(computeA4LandscapePrintFitScale(10, 10)).toBe(1);
  });

  it("returns 1 for non-positive dimensions", () => {
    expect(computeA4LandscapePrintFitScale(0, 100)).toBe(1);
    expect(computeA4LandscapePrintFitScale(100, -5)).toBe(1);
  });
});
