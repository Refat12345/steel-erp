/**
 * Truck-weighing workflow tests.
 *
 * These tests focus on the service layer's business logic — concurrency,
 * weight integrity, workflow separation (operator vs loader), and audit
 * logging — using fully mocked Prisma clients. DB constraints (partial
 * unique index, CHECK constraint on loading-confirmation pair) are asserted
 * indirectly via service-level behaviour.
 *
 * Covers the 11 minimum scenarios required by Part 9:
 *   1. register truck
 *   2. record tare
 *   3. loader confirms loading
 *   4. record gross
 *   5. calculate net weight
 *   6. prevent duplicate active session
 *   7. prevent gross before loader confirmation
 *   8. reject invalid weight
 *   9. concurrent tare submissions
 *  10. cancel session
 *  11. reopen session
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  customer: { findUnique: vi.fn() },
  masterContract: { findFirst: vi.fn() },
  salesOrder: { findUnique: vi.fn() },
  sizeLookup: { findMany: vi.fn() },
  truckOperation: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  truckRequestItem: { createMany: vi.fn() },
  weighSession: { findMany: vi.fn() },
  truckPhoto: { count: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// The Prisma client in the mock exposes `$transaction` but NOT every helper
// the Prisma engine provides. The retry helper inspects Prisma error codes
// at import time; mock it out to a passthrough to keep tests hermetic.
vi.mock("./tx-retry", () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
}));

import {
  registerTruck,
  enterTare,
  confirmLoadingComplete,
  enterGross,
  cancelOperation,
  reopenBeforeGross,
} from "./truck.service";
import { ServiceError } from "./errors";

// ─── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Inline transactions: execute the callback with the mock prisma as its
  // transaction client. Mirrors payment.service.test.ts.
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    typeof fn === "function" ? fn(mockPrisma) : fn,
  );
  // Default: FOR UPDATE lock resolves "row exists" unless a test overrides.
  mockPrisma.$queryRaw.mockResolvedValue([{ id: 1 }]);
  mockPrisma.auditLog.create.mockResolvedValue({});
});

// ─── 1. Register truck ────────────────────────────────────────

describe("registerTruck", () => {
  const validInput = {
    customerId: 1,
    plateNumber: "ABC-123",
    driverName: "Ali",
  };

  it("creates a truck operation and writes an audit log", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({ id: 1, isActive: true });
    mockPrisma.masterContract.findFirst.mockResolvedValue({
      contractNumber: "26-90",
    });
    mockPrisma.truckOperation.findFirst.mockResolvedValue(null);
    mockPrisma.truckOperation.create.mockResolvedValue({
      id: 42,
      plateNumber: "ABC-123",
      driverName: "Ali",
      status: "Queued",
      salesOrderNumber: null,
    });

    const result = await registerTruck(validInput, 7);

    expect(result.id).toBe(42);
    expect(mockPrisma.truckOperation.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    const auditCall = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe("create");
    expect(auditCall.data.entityType).toBe("TruckOperation");
    // Standardised audit shape — previousValue/newValue — required for
    // production-grade dispute traceability.
    expect(auditCall.data.details.event).toBe("truck_registered");
    expect(auditCall.data.details.previousValue).toBeNull();
    expect(auditCall.data.details.newValue.plateNumber).toBe("ABC-123");
  });

  it("rejects when the customer has no active master contract", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({ id: 1, isActive: true });
    mockPrisma.masterContract.findFirst.mockResolvedValue(null);

    await expect(registerTruck(validInput, 7)).rejects.toThrow(ServiceError);
    await expect(registerTruck(validInput, 7)).rejects.toThrow(/عقد عام نشط/);
  });
});

// ─── 2. Record tare  +  8. Reject invalid weight  +  9. Concurrent tare ──

describe("enterTare", () => {
  beforeEach(() => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "Queued",
      tareWeightKg: null,
    });
    mockPrisma.truckOperation.update.mockResolvedValue({
      id: 1,
      status: "FirstWeigh",
      tareWeightKg: 10_000,
    });
  });

  it("records tare weight and writes tare_recorded audit with previous/new values", async () => {
    const result = await enterTare(1, 10_000, 5);

    expect(result.status).toBe("FirstWeigh");
    // Every weight-writing path takes SELECT ... FOR UPDATE — no exceptions.
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.event).toBe("tare_recorded");
    expect(audit.data.details.previousValue).toEqual({
      status: "Queued",
      tareWeightKg: null,
    });
    expect(audit.data.details.newValue).toEqual({
      status: "FirstWeigh",
      tareWeightKg: 10_000,
    });
  });

  // Part 3 / Part 8 — hard-rail weight checks. Must run BEFORE any DB call
  // so malicious / buggy clients can't exhaust the connection pool.
  it.each([
    ["zero", 0],
    ["negative", -1],
    ["below hard-rail MIN_WEIGHT_KG", 50],
    ["above hard-rail MAX_WEIGHT_KG", 200_000],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
  ])("rejects tare weight = %s without touching the database", async (_label, kg) => {
    await expect(enterTare(1, kg, 5)).rejects.toThrow(ServiceError);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    expect(mockPrisma.truckOperation.update).not.toHaveBeenCalled();
  });

  it("prevents double-tare (second attempt sees tareWeightKg already set)", async () => {
    // Simulate the state AFTER a concurrent request has already written tare:
    // the second request acquires the row lock, reads tareWeightKg != null,
    // and must refuse with CONFLICT instead of overwriting it.
    mockPrisma.truckOperation.findUnique.mockResolvedValueOnce({
      id: 1,
      status: "FirstWeigh",
      tareWeightKg: 9_500,
    });

    await expect(enterTare(1, 10_000, 5)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(mockPrisma.truckOperation.update).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when SELECT FOR UPDATE finds no row", async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(enterTare(1, 10_000, 5)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ─── 3. Loader confirms loading ───────────────────────────────

describe("confirmLoadingComplete", () => {
  beforeEach(() => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "OnScale",
      loadingConfirmedAt: null,
      loaderId: null,
    });
    mockPrisma.weighSession.findMany.mockResolvedValue([
      { weightTons: 5 },
      { weightTons: 4 },
    ]);
    mockPrisma.truckPhoto.count.mockResolvedValue(1);
    mockPrisma.truckOperation.update.mockResolvedValue({
      id: 1,
      status: "LoadingComplete",
    });
  });

  it("stamps loaderId + loadingConfirmedAt atomically and writes loading_confirmed audit", async () => {
    const loaderUserId = 99;
    await confirmLoadingComplete(1, loaderUserId);

    const updateCall = mockPrisma.truckOperation.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("LoadingComplete");
    expect(updateCall.data.loaderId).toBe(loaderUserId);
    expect(updateCall.data.loadingConfirmedAt).toBeInstanceOf(Date);

    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.userId).toBe(loaderUserId);
    expect(audit.data.details.event).toBe("loading_confirmed");
    expect(audit.data.details.newValue.loaderId).toBe(loaderUserId);
    expect(audit.data.details.newValue.sessionCount).toBe(2);
    expect(audit.data.details.newValue.totalInternalTons).toBe(9);
  });

  it("refuses when no internal weigh-sessions exist", async () => {
    mockPrisma.weighSession.findMany.mockResolvedValueOnce([]);
    await expect(confirmLoadingComplete(1, 99)).rejects.toThrow(/وزنة واحدة/);
  });

  it("refuses when no photo uploaded", async () => {
    mockPrisma.truckPhoto.count.mockResolvedValueOnce(0);
    await expect(confirmLoadingComplete(1, 99)).rejects.toThrow(/صورة واحدة/);
  });
});

// ─── 4. Record gross + 5. Net weight + 7. Block gross before confirmation ──

describe("enterGross", () => {
  // Defaults: tare done, loading confirmed, ready for gross.
  beforeEach(() => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "LoadingComplete",
      tareWeightKg: 10_000,
      grossWeightKg: null,
      loadingConfirmedAt: new Date("2026-04-22T10:00:00Z"),
      loaderId: 99,
    });
    mockPrisma.truckOperation.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 1,
      status: "SecondWeigh",
      tareWeightKg: 10_000,
      grossWeightKg: data.grossWeightKg,
    }));
  });

  it("records gross and the audit log carries the computed net weight", async () => {
    await enterGross(1, 25_000, 7);

    expect(mockPrisma.truckOperation.update).toHaveBeenCalledTimes(1);
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.event).toBe("gross_recorded");
    expect(audit.data.details.newValue.grossWeightKg).toBe(25_000);
    expect(audit.data.details.newValue.tareWeightKg).toBe(10_000);
    // Net = gross - tare = 15_000. Central to invoicing — must always be
    // computed server-side and stamped into the audit record.
    expect(audit.data.details.newValue.netWeightKg).toBe(15_000);
    expect(audit.data.details.newValue.loaderId).toBe(99);
  });

  // Part 1 — the workflow-separation rule. This is the single most important
  // test in the suite: financial data depends on it being unconditionally
  // enforced at the service layer.
  it("blocks gross when loadingConfirmedAt is null (FORBIDDEN)", async () => {
    // Sticky override — both expectations below run the service twice, so
    // mockResolvedValueOnce would exhaust on the first call and the second
    // call would silently fall back to the beforeEach default (confirmed).
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "OnScale",
      tareWeightKg: 10_000,
      grossWeightKg: null,
      loadingConfirmedAt: null,
      loaderId: null,
    });

    await expect(enterGross(1, 25_000, 7)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(enterGross(1, 25_000, 7)).rejects.toThrow(
      /Loading must be confirmed before recording gross weight/,
    );
    expect(mockPrisma.truckOperation.update).not.toHaveBeenCalled();
  });

  it("rejects gross <= tare (weight integrity)", async () => {
    await expect(enterGross(1, 10_000, 7)).rejects.toThrow(
      /Gross weight must be greater than tare weight/,
    );
    await expect(enterGross(1, 9_999, 7)).rejects.toThrow(
      /Gross weight must be greater than tare weight/,
    );
  });

  it("prevents double-gross (CONFLICT)", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValueOnce({
      id: 1,
      status: "SecondWeigh",
      tareWeightKg: 10_000,
      grossWeightKg: 25_000,
      loadingConfirmedAt: new Date(),
      loaderId: 99,
    });
    await expect(enterGross(1, 26_000, 7)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it.each([
    ["zero", 0],
    ["below hard-rail min", 99],
    ["above hard-rail max", 100_001],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects invalid gross weight = %s early", async (_l, kg) => {
    await expect(enterGross(1, kg, 7)).rejects.toThrow(ServiceError);
  });
});

// ─── 6. Prevent duplicate active session ───────────────────────

describe("registerTruck — duplicate active session", () => {
  it("returns CONFLICT (409) when an open truck for the same plate exists", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({ id: 1, isActive: true });
    mockPrisma.masterContract.findFirst.mockResolvedValue({
      contractNumber: "26-90",
    });
    // Service-level pre-check: another open operation exists for this plate.
    // The DB-level partial unique index is a second layer of defence and is
    // asserted separately in an integration test (not here).
    mockPrisma.truckOperation.findFirst.mockResolvedValue({
      id: 99,
      status: "FirstWeigh",
    });

    try {
      await registerTruck(
        { customerId: 1, plateNumber: "SAME-1", driverName: "Ali" },
        7,
      );
      throw new Error("expected ServiceError");
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceError);
      expect((e as ServiceError).code).toBe("CONFLICT");
      expect((e as ServiceError).message).toMatch(
        /يوجد عملية مفتوحة|Truck already has an active session/,
      );
    }

    expect(mockPrisma.truckOperation.create).not.toHaveBeenCalled();
  });
});

// ─── 10. Cancel session ───────────────────────────────────────

describe("cancelOperation", () => {
  it("transitions to Cancelled, stores reason, and writes session_cancelled audit", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "FirstWeigh",
      cancelReason: null,
      closedAt: null,
      closedById: null,
    });
    mockPrisma.truckOperation.update.mockResolvedValue({
      id: 1,
      status: "Cancelled",
      cancelReason: "wrong customer",
      closedAt: new Date("2026-04-22T12:00:00Z"),
      closedById: 7,
    });

    const result = await cancelOperation(1, "  wrong customer  ", 7);

    expect(result.status).toBe("Cancelled");
    const updateCall = mockPrisma.truckOperation.update.mock.calls[0][0];
    // Whitespace must be trimmed — otherwise reports group "wrong customer"
    // separately from "  wrong customer ".
    expect(updateCall.data.cancelReason).toBe("wrong customer");

    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.event).toBe("session_cancelled");
    expect(audit.data.details.newValue.status).toBe("Cancelled");
    expect(audit.data.details.newValue.closedById).toBe(7);
  });

  it("requires a non-empty reason", async () => {
    await expect(cancelOperation(1, "   ", 7)).rejects.toThrow(/سبب الإلغاء/);
  });
});

// ─── 11. Reopen session ───────────────────────────────────────

describe("reopenBeforeGross", () => {
  it("reopens from LoadingComplete → OnScale and CLEARS the loader confirmation", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "LoadingComplete",
      loadingConfirmedAt: new Date("2026-04-22T10:00:00Z"),
      loaderId: 99,
    });
    mockPrisma.truckOperation.update.mockResolvedValue({
      id: 1,
      status: "OnScale",
      loadingConfirmedAt: null,
      loaderId: null,
    });

    await reopenBeforeGross(1, 7);

    const updateCall = mockPrisma.truckOperation.update.mock.calls[0][0];
    // Critical: reopening invalidates the prior confirmation. Without
    // clearing these fields, a reopen would allow gross to be recorded
    // without a fresh loader confirmation — defeating Part 1's rule.
    expect(updateCall.data.status).toBe("OnScale");
    expect(updateCall.data.loadingConfirmedAt).toBeNull();
    expect(updateCall.data.loaderId).toBeNull();

    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.event).toBe("session_reopened");
    expect(audit.data.details.previousValue.loaderId).toBe(99);
    expect(audit.data.details.newValue.loaderId).toBeNull();
  });

  it("refuses to reopen from any status other than LoadingComplete", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "SecondWeigh",
      loadingConfirmedAt: new Date(),
      loaderId: 99,
    });
    await expect(reopenBeforeGross(1, 7)).rejects.toThrow(/اكتمال التحميل/);
  });
});
