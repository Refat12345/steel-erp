import { describe, it, expect } from "vitest";
import { ServiceError } from "./errors";

describe("ServiceError", () => {
  it("defaults to BAD_REQUEST code and stores messageKey", () => {
    const err = new ServiceError("invalidData");
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.messageKey).toBe("invalidData");
    expect(err.message).toBe("invalidData");
    expect(err.name).toBe("ServiceError");
  });

  it("accepts NOT_FOUND code", () => {
    const err = new ServiceError("operationNotFound", "NOT_FOUND");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.messageKey).toBe("operationNotFound");
  });

  it("accepts FORBIDDEN code and params", () => {
    const err = new ServiceError("unknownPermissionCode", "FORBIDDEN", {
      code: "x.y",
    });
    expect(err.code).toBe("FORBIDDEN");
    expect(err.params).toEqual({ code: "x.y" });
  });

  it("is an instance of Error", () => {
    expect(new ServiceError("test")).toBeInstanceOf(Error);
  });
});
