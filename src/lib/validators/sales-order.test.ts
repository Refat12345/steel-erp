import { describe, it, expect } from "vitest";
import { salesOrderCreateSchema } from "./sales-order";

function validBase(overrides: Record<string, unknown> = {}) {
  return {
    contractNumber: "26-01",
    kind: "REBAR",
    grade: "FIRST",
    settlementMode: "CREDIT",
    paymentDeadlineDays: 28,
    totalQtyTons: 500,
    toleranceType: "percentage",
    toleranceValue: 5,
    specialRatioPct: 10,
    orderDate: "2026-05-01",
    deliveryDate: "2026-08-01",
    notes: "",
    ...overrides,
  };
}

describe("salesOrderCreateSchema", () => {
  it("accepts a valid REBAR CREDIT order", () => {
    const result = salesOrderCreateSchema.safeParse(validBase());
    expect(result.success).toBe(true);
  });

  it("accepts a valid SCRAP PAYMENT_PLAN order", () => {
    const result = salesOrderCreateSchema.safeParse(
      validBase({
        kind: "SCRAP",
        grade: null,
        settlementMode: "PAYMENT_PLAN",
        paymentDeadlineDays: null,
        specialRatioPct: null,
      })
    );
    expect(result.success).toBe(true);
  });

  it("accepts a valid SHORTBAR_1_4M order", () => {
    const result = salesOrderCreateSchema.safeParse(
      validBase({
        kind: "SHORTBAR_1_4M",
        grade: null,
        settlementMode: "CREDIT",
        paymentDeadlineDays: 30,
        specialRatioPct: null,
      })
    );
    expect(result.success).toBe(true);
  });

  // ─── kind + grade rules ─────────────────────────────────────────

  it("rejects REBAR without grade", () => {
    const result = salesOrderCreateSchema.safeParse(validBase({ grade: null }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const gradeIssue = result.error.issues.find((i) => i.path.includes("grade"));
      expect(gradeIssue).toBeDefined();
      expect(gradeIssue!.message).toContain("النخب مطلوب");
    }
  });

  it("rejects SCRAP with grade set", () => {
    const result = salesOrderCreateSchema.safeParse(
      validBase({ kind: "SCRAP", grade: "FIRST", specialRatioPct: null })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const gradeIssue = result.error.issues.find((i) => i.path.includes("grade"));
      expect(gradeIssue).toBeDefined();
      expect(gradeIssue!.message).toContain("النخب يُحدد فقط");
    }
  });

  it("rejects SHORTBAR_4_12M with grade set", () => {
    const result = salesOrderCreateSchema.safeParse(
      validBase({ kind: "SHORTBAR_4_12M", grade: "SECOND", specialRatioPct: null })
    );
    expect(result.success).toBe(false);
  });

  // ─── settlement mode + payment deadline ─────────────────────────

  it("rejects CREDIT without paymentDeadlineDays", () => {
    const result = salesOrderCreateSchema.safeParse(
      validBase({ paymentDeadlineDays: null })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("paymentDeadlineDays"));
      expect(issue).toBeDefined();
      expect(issue!.message).toContain("مهلة السداد مطلوبة");
    }
  });

  it("rejects PAYMENT_PLAN with paymentDeadlineDays set", () => {
    const result = salesOrderCreateSchema.safeParse(
      validBase({
        kind: "SCRAP",
        grade: null,
        settlementMode: "PAYMENT_PLAN",
        paymentDeadlineDays: 28,
        specialRatioPct: null,
      })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("paymentDeadlineDays"));
      expect(issue).toBeDefined();
      expect(issue!.message).toContain("مهلة السداد تُحدد فقط");
    }
  });

  // ─── special ratio rules ────────────────────────────────────────

  it("rejects SCRAP with specialRatioPct > 0", () => {
    const result = salesOrderCreateSchema.safeParse(
      validBase({
        kind: "SCRAP",
        grade: null,
        settlementMode: "PAYMENT_PLAN",
        paymentDeadlineDays: null,
        specialRatioPct: 15,
      })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("specialRatioPct"));
      expect(issue).toBeDefined();
      expect(issue!.message).toContain("النسبة الخاصة تُستخدم فقط");
    }
  });

  it("allows REBAR with specialRatioPct", () => {
    const result = salesOrderCreateSchema.safeParse(validBase({ specialRatioPct: 15 }));
    expect(result.success).toBe(true);
  });

  it("allows specialRatioPct = 0 for non-REBAR (treated as not set)", () => {
    const result = salesOrderCreateSchema.safeParse(
      validBase({
        kind: "SHORTBAR_1_4M",
        grade: null,
        specialRatioPct: 0,
        paymentDeadlineDays: 28,
      })
    );
    expect(result.success).toBe(true);
  });

  // ─── tolerance validation ───────────────────────────────────────

  it("rejects negative tolerance value", () => {
    const result = salesOrderCreateSchema.safeParse(validBase({ toleranceValue: -1 }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid tolerance type", () => {
    const result = salesOrderCreateSchema.safeParse(validBase({ toleranceType: "invalid" }));
    expect(result.success).toBe(false);
  });

  it("accepts weight tolerance type", () => {
    const result = salesOrderCreateSchema.safeParse(
      validBase({ toleranceType: "weight", toleranceValue: 25 })
    );
    expect(result.success).toBe(true);
  });

  // ─── quantity validation ────────────────────────────────────────

  it("rejects zero quantity", () => {
    const result = salesOrderCreateSchema.safeParse(validBase({ totalQtyTons: 0 }));
    expect(result.success).toBe(false);
  });

  it("rejects negative quantity", () => {
    const result = salesOrderCreateSchema.safeParse(validBase({ totalQtyTons: -100 }));
    expect(result.success).toBe(false);
  });

  // ─── missing required fields ────────────────────────────────────

  it("rejects missing contractNumber", () => {
    const result = salesOrderCreateSchema.safeParse(validBase({ contractNumber: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects missing kind", () => {
    const { kind, ...rest } = validBase();
    const result = salesOrderCreateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing dates", () => {
    const result = salesOrderCreateSchema.safeParse(validBase({ orderDate: "" }));
    expect(result.success).toBe(false);
  });
});
