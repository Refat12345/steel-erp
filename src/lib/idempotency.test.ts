import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

const mockPrisma = vi.hoisted(() => ({
  idempotencyKey: {
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/i18n/request-locale", () => ({
  getRequestLocale: async () => "ar",
}));

import { withIdempotency, cleanupExpiredIdempotencyKeys } from "./idempotency";

function makeReq(body: string, opts: { key?: string; url?: string } = {}) {
  const url = opts.url ?? "https://example.com/api/trucks/1/tare";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.key) headers["Idempotency-Key"] = opts.key;
  return new NextRequest(url, { method: "PATCH", headers, body });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
  mockPrisma.idempotencyKey.create.mockResolvedValue({});
  mockPrisma.idempotencyKey.delete.mockResolvedValue({});
});

describe("withIdempotency", () => {
  it("is a no-op when no Idempotency-Key header is present", async () => {
    const compute = vi
      .fn()
      .mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));
    const res = await withIdempotency(makeReq("{}"), 1, "{}", compute);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(mockPrisma.idempotencyKey.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.idempotencyKey.create).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("persists a 2xx response on first execution", async () => {
    const compute = vi
      .fn()
      .mockResolvedValue(
        NextResponse.json({ success: true, data: { id: 1 } }, { status: 200 }),
      );

    const res = await withIdempotency(
      makeReq('{"w":1}', { key: "k1" }),
      42,
      '{"w":1}',
      compute,
    );

    expect(compute).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(mockPrisma.idempotencyKey.create).toHaveBeenCalledTimes(1);
    const createArg = mockPrisma.idempotencyKey.create.mock.calls[0]![0];
    expect(createArg.data.userId).toBe(42);
    expect(createArg.data.key).toBe("k1");
    expect(createArg.data.responseStatus).toBe(200);
    expect(createArg.data.responseBody).toEqual({ success: true, data: { id: 1 } });
  });

  it("replays a cached 2xx response on retry with the same body", async () => {
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      userId: 42,
      key: "k1",
      method: "PATCH",
      path: "/api/trucks/1/tare",
      // sha256("PATCH\n/api/trucks/1/tare\n{\"w\":1}") precomputed not needed —
      // we just recompute in the helper; any cached hash equal to the fresh
      // one for the same inputs passes. To keep the test deterministic we
      // route the replay branch by feeding the helper the same body that
      // produced the cached hash.
      requestHash: "__placeholder__",
      responseStatus: 200,
      responseBody: { success: true, data: { id: 1 } },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    // Force the hash check to pass by spying into the finder and rewriting
    // requestHash to whatever the helper computes. Easiest approach: do it
    // in two passes — capture the computed hash from the create() attempt in
    // an independent run.
    const capturedHash = await captureHash("PATCH", "/api/trucks/1/tare", '{"w":1}');
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      userId: 42,
      key: "k1",
      method: "PATCH",
      path: "/api/trucks/1/tare",
      requestHash: capturedHash,
      responseStatus: 201,
      responseBody: { success: true, replay: true },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const compute = vi.fn();
    const res = await withIdempotency(
      makeReq('{"w":1}', { key: "k1" }),
      42,
      '{"w":1}',
      compute,
    );

    expect(compute).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ success: true, replay: true });
  });

  it("returns 409 when the same key is reused with a different body", async () => {
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      userId: 42,
      key: "k1",
      method: "PATCH",
      path: "/api/trucks/1/tare",
      requestHash: "some-other-hash",
      responseStatus: 200,
      responseBody: { success: true },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const compute = vi.fn();
    const res = await withIdempotency(
      makeReq('{"w":2}', { key: "k1" }),
      42,
      '{"w":2}',
      compute,
    );

    expect(compute).not.toHaveBeenCalled();
    expect(res.status).toBe(409);
  });

  it("drops an expired entry and re-executes the handler", async () => {
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      userId: 42,
      key: "k1",
      method: "PATCH",
      path: "/api/trucks/1/tare",
      requestHash: "x",
      responseStatus: 200,
      responseBody: { success: true },
      createdAt: new Date(Date.now() - 48 * 3_600_000),
      expiresAt: new Date(Date.now() - 1000),
    });

    const compute = vi
      .fn()
      .mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));

    await withIdempotency(
      makeReq('{"w":1}', { key: "k1" }),
      42,
      '{"w":1}',
      compute,
    );

    expect(mockPrisma.idempotencyKey.delete).toHaveBeenCalledTimes(1);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(mockPrisma.idempotencyKey.create).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache 4xx responses", async () => {
    const compute = vi
      .fn()
      .mockResolvedValue(
        NextResponse.json({ success: false, error: "bad" }, { status: 400 }),
      );

    await withIdempotency(
      makeReq('{"w":1}', { key: "k1" }),
      42,
      '{"w":1}',
      compute,
    );

    expect(compute).toHaveBeenCalledTimes(1);
    expect(mockPrisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it("does NOT cache 5xx responses", async () => {
    const compute = vi
      .fn()
      .mockResolvedValue(
        NextResponse.json({ success: false, error: "boom" }, { status: 500 }),
      );

    await withIdempotency(
      makeReq('{"w":1}', { key: "k1" }),
      42,
      '{"w":1}',
      compute,
    );

    expect(mockPrisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it("rejects Idempotency-Key values that are too long", async () => {
    const compute = vi.fn();
    const longKey = "x".repeat(500);
    const res = await withIdempotency(
      makeReq('{"w":1}', { key: longKey }),
      42,
      '{"w":1}',
      compute,
    );

    expect(res.status).toBe(400);
    expect(compute).not.toHaveBeenCalled();
  });

  it("serializes 5 concurrent same-key requests — 1 executes, 4 replay", async () => {
    // Simulate DB state across the 5 parallel calls:
    //  - All 5 see null on their initial findUnique (no row yet).
    //  - Leader creates the row successfully.
    //  - Waiters re-check after the leader finishes and see the cached row.
    const storedRow: {
      userId: number;
      key: string;
      method: string;
      path: string;
      requestHash: string;
      responseStatus: number;
      responseBody: unknown;
      createdAt: Date;
      expiresAt: Date;
    } | null = null;

    let rowRef: typeof storedRow = storedRow;
    mockPrisma.idempotencyKey.findUnique.mockImplementation(async () => rowRef);
    mockPrisma.idempotencyKey.create.mockImplementation(async (args) => {
      rowRef = {
        ...args.data,
        createdAt: new Date(),
      };
      return rowRef;
    });

    let computeCount = 0;
    const compute = async () => {
      computeCount++;
      // Simulate the actual business-logic time so waiters really do wait.
      await new Promise((r) => setTimeout(r, 25));
      return NextResponse.json({ ok: true, attempt: computeCount }, { status: 200 });
    };

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        withIdempotency(
          makeReq('{"w":1}', { key: "race-key" }),
          42,
          '{"w":1}',
          compute,
        ),
      ),
    );

    expect(computeCount).toBe(1);
    expect(mockPrisma.idempotencyKey.create).toHaveBeenCalledTimes(1);

    const bodies = await Promise.all(results.map((r) => r.json()));
    for (const body of bodies) {
      expect(body).toEqual({ ok: true, attempt: 1 });
    }
    for (const r of results) {
      expect(r.status).toBe(200);
    }
  });

  it("swallows P2002 if a concurrent request already stored the key", async () => {
    mockPrisma.idempotencyKey.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "6.0.0",
      }),
    );
    const compute = vi
      .fn()
      .mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));

    const res = await withIdempotency(
      makeReq('{"w":1}', { key: "k1" }),
      42,
      '{"w":1}',
      compute,
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.idempotencyKey.create).toHaveBeenCalledTimes(1);
  });
});

describe("cleanupExpiredIdempotencyKeys", () => {
  it("deletes rows whose expiresAt is in the past and returns the count", async () => {
    mockPrisma.idempotencyKey.deleteMany.mockResolvedValueOnce({ count: 17 });
    const before = Date.now();

    const deleted = await cleanupExpiredIdempotencyKeys();

    expect(deleted).toBe(17);
    expect(mockPrisma.idempotencyKey.deleteMany).toHaveBeenCalledTimes(1);
    const call = mockPrisma.idempotencyKey.deleteMany.mock.calls[0][0];
    expect(call.where.expiresAt.lt).toBeInstanceOf(Date);
    // The cutoff must be "now-ish" — i.e. not a stale captured value.
    expect((call.where.expiresAt.lt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("returns 0 when nothing is expired", async () => {
    mockPrisma.idempotencyKey.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(cleanupExpiredIdempotencyKeys()).resolves.toBe(0);
  });
});

/**
 * Compute the request hash the helper would generate, by running it once in
 * "store" mode and reading back the value it persisted. We then reuse that
 * hash in the "replay" assertion above so the test doesn't depend on the
 * internal hashing algorithm.
 */
async function captureHash(method: string, path: string, body: string): Promise<string> {
  const req = new NextRequest(`https://example.com${path}`, {
    method,
    headers: { "Idempotency-Key": "__hash-capture__" },
    body,
  });
  let captured = "";
  mockPrisma.idempotencyKey.findUnique.mockResolvedValueOnce(null);
  mockPrisma.idempotencyKey.create.mockImplementationOnce(async (args) => {
    captured = args.data.requestHash;
    return args.data;
  });
  await withIdempotency(
    req,
    42,
    body,
    async () => NextResponse.json({ ok: true }, { status: 200 }),
  );
  return captured;
}
