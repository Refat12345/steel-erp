import { describe, it, expect } from "vitest";
import { customerCreateSchema, customerUpdateSchema } from "./customer";

const validInput = {
  fullName: "أحمد محمد",
  fatherName: "محمد",
  nationalId: "12345678",
  phonePrimary: "0911111111",
  companyAddress: "دمشق — شارع الصناعة",
};

describe("customerCreateSchema", () => {
  it("accepts valid input", () => {
    const result = customerCreateSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("accepts optional fields as empty strings", () => {
    const result = customerCreateSchema.safeParse({
      ...validInput,
      phoneSecondary: "",
      commercialRegistration: "",
      notes: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing fullName", () => {
    const { fullName: _, ...rest } = validInput;
    const result = customerCreateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing nationalId", () => {
    const { nationalId: _, ...rest } = validInput;
    const result = customerCreateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects fullName shorter than 3 characters", () => {
    const result = customerCreateSchema.safeParse({
      ...validInput,
      fullName: "أب",
    });
    expect(result.success).toBe(false);
  });

  it("rejects notes exceeding 2000 characters", () => {
    const result = customerCreateSchema.safeParse({
      ...validInput,
      notes: "x".repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});

describe("customerUpdateSchema", () => {
  it("accepts partial updates", () => {
    const result = customerUpdateSchema.safeParse({ fullName: "خالد" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object (no updates)", () => {
    const result = customerUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
