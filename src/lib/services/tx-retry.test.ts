import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { withRetry } from "./tx-retry";

function makeSerializationError() {
  return new Prisma.PrismaClientKnownRequestError("serialization failure", {
    code: "P2034",
    clientVersion: "6.0.0",
  });
}

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on P2034 serialization failure", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeSerializationError())
      .mockResolvedValueOnce("recovered");

    const result = await withRetry(fn);
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after 3 failed attempts", async () => {
    const fn = vi.fn().mockRejectedValue(makeSerializationError());
    await expect(withRetry(fn)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-serialization errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("unrelated"));
    await expect(withRetry(fn)).rejects.toThrow("unrelated");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry other Prisma error codes", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("unique constraint", {
      code: "P2002",
      clientVersion: "6.0.0",
    });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
