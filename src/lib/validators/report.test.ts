import { describe, it, expect } from "vitest";
import {
  dailyBilletReportQuerySchema,
  governorateWithdrawalsQuerySchema,
} from "./report";

describe("governorateWithdrawalsQuerySchema", () => {
  it("accepts a date range with optional customer, destination and size filters", () => {
    const parsed = governorateWithdrawalsQuerySchema.parse({
      from: "2026-06-01",
      to: "2026-06-10",
      customerId: "5",
      destinationId: "12",
      sizeId: "3",
    });
    expect(parsed).toEqual({
      from: "2026-06-01",
      to: "2026-06-10",
      customerId: 5,
      destinationId: 12,
      sizeId: 3,
    });
  });

  it("treats empty optional filters as undefined", () => {
    const parsed = governorateWithdrawalsQuerySchema.parse({
      from: "2026-06-01",
      to: "2026-06-10",
      customerId: "",
      destinationId: "",
      sizeId: null,
    });
    expect(parsed.customerId).toBeUndefined();
    expect(parsed.destinationId).toBeUndefined();
    expect(parsed.sizeId).toBeUndefined();
  });

  it("rejects invalid date formats", () => {
    expect(() =>
      governorateWithdrawalsQuerySchema.parse({
        from: "01-06-2026",
        to: "2026-06-10",
      }),
    ).toThrow();
  });
});

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
