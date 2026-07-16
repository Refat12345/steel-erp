import { describe, it, expect } from "vitest";
import { dailyBilletReportQuerySchema } from "./report";

describe("dailyBilletReportQuerySchema", () => {
  it("accepts a date with optional supplier and contract filters", () => {
    const parsed = dailyBilletReportQuerySchema.parse({
      date: "2026-06-06",
      supplierName: " asda ",
      contractNumber: "P-26-001",
    });
    expect(parsed).toEqual({
      date: "2026-06-06",
      supplierName: "asda",
      contractNumber: "P-26-001",
    });
  });

  it("treats empty optional filters as undefined", () => {
    const parsed = dailyBilletReportQuerySchema.parse({
      date: "2026-06-06",
      supplierName: "",
      contractNumber: null,
    });
    expect(parsed.supplierName).toBeUndefined();
    expect(parsed.contractNumber).toBeUndefined();
  });

  it("rejects an invalid date format", () => {
    expect(() =>
      dailyBilletReportQuerySchema.parse({ date: "06-06-2026" }),
    ).toThrow();
  });
});
