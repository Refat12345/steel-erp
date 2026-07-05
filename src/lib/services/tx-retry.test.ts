import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { withRetry } from "./tx-retry";

function makeSerializationError() {
  return new Prisma.PrismaClientKnownRequestError("serialization failure", {
    code: "P2034",
    clientVersion: "6.0.0",
  });
}

function makeUniqueError(target: string | string[]) {
  return new Prisma.PrismaClientKnownRequestError("unique constraint", {
    code: "P2002",
    clientVersion: "6.0.0",
    meta: { target },
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

  it("throws after 5 failed attempts", async () => {
    const fn = vi.fn().mockRejectedValue(makeSerializationError());
    await expect(withRetry(fn)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("does not retry non-serialization errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("unrelated"));
    await expect(withRetry(fn)).rejects.toThrow("unrelated");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries P2002 on weigh_sessions session_number collision", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeUniqueError(["truck_operation_id", "session_number"]))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry P2002 on unrelated unique constraints (e.g. plate number)", async () => {
    const fn = vi.fn().mockRejectedValue(makeUniqueError(["plate_number"]));
    await expect(withRetry(fn)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries P2002 on billet receipt_number collision (generated sequence)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeUniqueError(["receipt_number"]))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries P2002 on supplier contract_number collision (generated sequence)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeUniqueError(["contractNumber"]))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries P2002 when Prisma reports the DB constraint name as a string", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeUniqueError("billet_receipts_receipt_number_key"))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry P2002 on supplier_contract_number FK uniques (piece lines)", async () => {
    // Exact-token matching must not confuse `supplier_contract_number`
    // (a real domain error on piece-line uniques) with `contract_number`.
    const fn = vi
      .fn()
      .mockRejectedValue(makeUniqueError(["supplier_contract_number", "billet_length_m"]));
    await expect(withRetry(fn)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry P2002 on the open-plate partial unique index", async () => {
    const fn = vi.fn().mockRejectedValue(makeUniqueError("billet_receipts_plate_open_uniq"));
    await expect(withRetry(fn)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries raw-query PG 40001 serialization failures", async () => {
    // Shape of the error Prisma throws when $queryRaw SELECT ... FOR UPDATE
    // inside a Serializable transaction aborts with PG 40001.
    const rawErr = new Error(
      "Raw query failed. Code: `40001`. Message: `could not serialize access due to concurrent update`",
    );
    const fn = vi.fn().mockRejectedValueOnce(rawErr).mockResolvedValueOnce("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries raw-query PG 40P01 deadlock failures", async () => {
    const rawErr = new Error("Raw query failed. Code: `40P01`. Message: `deadlock detected`");
    const fn = vi.fn().mockRejectedValueOnce(rawErr).mockResolvedValueOnce("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
