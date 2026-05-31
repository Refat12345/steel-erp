import { describe, it, expect } from "vitest";
import { truckUpdateSchema } from "./truck";

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
