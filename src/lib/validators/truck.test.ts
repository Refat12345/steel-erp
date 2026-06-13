import { describe, it, expect } from "vitest";
import {
  truckRegisterSchema,
  truckUpdateSchema,
  grossSchema,
  loadingCompleteSchema,
  correctGrossSchema,
  weighSessionDeleteSchema,
} from "./truck";

describe("truckUpdateSchema", () => {
  it("accepts null notes (clear after edit)", () => {
    const result = truckUpdateSchema.safeParse({
      expectedVersion: 0,
      driverName: "رامي",
      notes: null,
      destinationId: null,
      requestItems: [{ sizeId: 1, bundleCount: 4 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts omitted operationalGrade on partial patch", () => {
    const result = truckUpdateSchema.safeParse({
      expectedVersion: 1,
      driverName: "رامي",
      notes: null,
      requestItems: [{ sizeId: 1, bundleCount: 4 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operationalGrade).toBeUndefined();
    }
  });
});

describe("weighSessionDeleteSchema", () => {
  it("requires expectedVersion", () => {
    expect(weighSessionDeleteSchema.safeParse({}).success).toBe(false);
    expect(weighSessionDeleteSchema.safeParse({ expectedVersion: 0 }).success).toBe(
      true,
    );
  });

  it("rejects negative version", () => {
    expect(weighSessionDeleteSchema.safeParse({ expectedVersion: -1 }).success).toBe(
      false,
    );
  });
});

describe("requestItems grade (per-line grading)", () => {
  it("accepts the same size twice with different grades", () => {
    const result = truckRegisterSchema.safeParse({
      plateNumber: "ABC-123",
      driverName: "Ali",
      requestItems: [
        { sizeId: 1, grade: "FIRST", bundleCount: 4 },
        { sizeId: 1, grade: "SECOND", bundleCount: 2 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts null/omitted grade and rejects unknown grades", () => {
    expect(
      truckRegisterSchema.safeParse({
        plateNumber: "ABC-123",
        driverName: "Ali",
        requestItems: [{ sizeId: 1, grade: null, bundleCount: 4 }],
      }).success,
    ).toBe(true);
    expect(
      truckRegisterSchema.safeParse({
        plateNumber: "ABC-123",
        driverName: "Ali",
        requestItems: [{ sizeId: 1, grade: "THIRD", bundleCount: 4 }],
      }).success,
    ).toBe(false);
  });
});

describe("grossSchema exit mode", () => {
  it("defaults exit to 'final' for clients that omit it (backward compat)", () => {
    const result = grossSchema.safeParse({ weightKg: 25_000 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.exit).toBe("final");
  });

  it("accepts 'return' and rejects anything else", () => {
    const ok = grossSchema.safeParse({ weightKg: 25_000, exit: "return" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.exit).toBe("return");

    expect(grossSchema.safeParse({ weightKg: 25_000, exit: "again" }).success).toBe(
      false,
    );
  });
});

describe("loadingCompleteSchema", () => {
  it("accepts empty body, explicit grade, and null grade", () => {
    expect(loadingCompleteSchema.safeParse({}).success).toBe(true);
    expect(loadingCompleteSchema.safeParse({ grade: "FIRST" }).success).toBe(true);
    expect(loadingCompleteSchema.safeParse({ grade: null }).success).toBe(true);
    expect(loadingCompleteSchema.safeParse({ grade: "BAD" }).success).toBe(false);
  });
});

describe("correctGrossSchema", () => {
  it("does not accept an exit field — corrections never reshape the round chain", () => {
    const result = correctGrossSchema.safeParse({
      weightKg: 25_000,
      expectedVersion: 2,
      exit: "return",
    });
    // Unknown keys are stripped, not honoured.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("exit");
    }
  });
});
