import { describe, it, expect } from "vitest";
import { ServiceError } from "./errors";

describe("ServiceError", () => {
  it("defaults to BAD_REQUEST code", () => {
    const err = new ServiceError("خطأ");
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("خطأ");
    expect(err.name).toBe("ServiceError");
  });

  it("accepts NOT_FOUND code", () => {
    const err = new ServiceError("غير موجود", "NOT_FOUND");
    expect(err.code).toBe("NOT_FOUND");
  });

  it("accepts FORBIDDEN code", () => {
    const err = new ServiceError("ممنوع", "FORBIDDEN");
    expect(err.code).toBe("FORBIDDEN");
  });

  it("is an instance of Error", () => {
    expect(new ServiceError("test")).toBeInstanceOf(Error);
  });
});
