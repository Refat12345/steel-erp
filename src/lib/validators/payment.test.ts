import { describe, it, expect } from "vitest";
import { paymentCreateSchema } from "./payment";

const validBase = (overrides = {}) => ({
  customerId: 1,
  amount: 10000,
  method: "CASH" as const,
  paymentDate: "2026-04-10",
  referenceNumber: "",
  notes: "",
  ...overrides,
});

describe("paymentCreateSchema", () => {
  it("accepts valid payment data", () => {
    const result = paymentCreateSchema.safeParse(validBase());
    expect(result.success).toBe(true);
  });

  it("accepts all payment methods", () => {
    for (const method of ["CASH", "BANK_TRANSFER", "CHECK"]) {
      const result = paymentCreateSchema.safeParse(validBase({ method }));
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid payment method", () => {
    const result = paymentCreateSchema.safeParse(validBase({ method: "BITCOIN" }));
    expect(result.success).toBe(false);
  });

  it("rejects zero amount", () => {
    const result = paymentCreateSchema.safeParse(validBase({ amount: 0 }));
    expect(result.success).toBe(false);
  });

  it("rejects negative amount", () => {
    const result = paymentCreateSchema.safeParse(validBase({ amount: -100 }));
    expect(result.success).toBe(false);
  });

  it("rejects missing customerId", () => {
    const { customerId: _customerId, ...data } = validBase();
    const result = paymentCreateSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects missing paymentDate", () => {
    const result = paymentCreateSchema.safeParse(validBase({ paymentDate: "" }));
    expect(result.success).toBe(false);
  });

  it("accepts optional referenceNumber and notes", () => {
    const result = paymentCreateSchema.safeParse(
      validBase({ referenceNumber: "REF-001", notes: "test note" }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects extremely large amount", () => {
    const result = paymentCreateSchema.safeParse(
      validBase({ amount: 9_999_999_999_999 }),
    );
    expect(result.success).toBe(false);
  });
});
