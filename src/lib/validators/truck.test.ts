import { describe, it, expect } from "vitest";
import { truckUpdateSchema, weighSessionDeleteSchema } from "./truck";

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
