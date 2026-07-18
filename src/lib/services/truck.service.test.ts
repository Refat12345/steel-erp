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
  destination: { findUnique: vi.fn() },
  sizeLookup: { findMany: vi.fn() },
  truckOperation: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  truckRequestItem: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  weighSession: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  truckPhoto: { count: vi.fn(), updateMany: vi.fn() },
  bridgeRound: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
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
// Analytics-start clamp: passthrough by default (no start date configured).
// Individual tests override to exercise the clamped path.
const mockClampEventWindow = vi.hoisted(() =>
  vi.fn(async (from?: Date, to?: Date) => ({
    from,
    to,
    clamped: false,
    analyticsStartDate: null as string | null,
  })),
);
vi.mock("./settings.service", () => ({
  clampEventWindow: mockClampEventWindow,
  getAnalyticsStartDateValue: vi.fn(async () => null),
}));

import {
  registerTruck,
  updateTruckBeforeWeigh,
  updateTruckNotes,
  listOperations,
  listLoadedTrucks,
  enterTare,
  correctTare,
  correctGross,
  confirmLoadingComplete,
  enterGross,
  closeOperation,
  cancelOperation,
  reopenBeforeGross,
  editWeighSession,
  deleteWeighSession,
} from "./truck.service";
import { ServiceError } from "./errors";
import { getOperationalDayWindow } from "@/lib/operational-day";

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
  // Round-machinery defaults — individual suites override findFirst via
  // mockRounds() below.
  mockPrisma.bridgeRound.create.mockResolvedValue({ id: 11, roundNumber: 1 });
  mockPrisma.bridgeRound.update.mockResolvedValue({});
  mockPrisma.bridgeRound.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.truckPhoto.updateMany.mockResolvedValue({ count: 0 });
});

// ─── Round helpers ─────────────────────────────────────────────
//
// `bridgeRound.findFirst` serves two distinct service queries:
//   - getOpenRound        → where.endWeightKg === null
//   - last/any closed round → where.endWeightKg = { not: null }
// Dispatch on the where clause so a single mock serves both.
interface MockRound {
  id: number;
  roundNumber: number;
  grade?: string | null;
  sizeId?: number | null;
  startWeightKg?: number;
  endWeightKg?: number | null;
  isFinal?: boolean;
  version?: number;
}

function mockRounds({
  open = null,
  lastClosed = null,
}: {
  open?: MockRound | null;
  lastClosed?: MockRound | null;
}) {
  mockPrisma.bridgeRound.findFirst.mockImplementation(
    async (args: { where?: Record<string, unknown> } | undefined) => {
      const endWeightKg = args?.where?.endWeightKg;
      if (endWeightKg === null) return open;
      if (typeof endWeightKg === "object" && endWeightKg !== null) return lastClosed;
      return null;
    },
  );
}

// ─── List Operations ─────────────────────────────────────────────

describe("listOperations", () => {
  it("filters createdAt by an operational day half-open window", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    mockPrisma.truckOperation.count.mockResolvedValue(0);
    const window = getOperationalDayWindow("2026-06-06");

    await listOperations(
      { dateFrom: window.from, dateTo: window.to },
      { page: 1, pageSize: 25 },
    );

    expect(mockPrisma.truckOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdAt: {
            gte: new Date(2026, 5, 6, 8, 0, 0, 0),
            lt: new Date(2026, 5, 7, 8, 0, 0, 0),
          },
        },
      }),
    );
    expect(mockPrisma.truckOperation.count).toHaveBeenCalledWith({
      where: {
        createdAt: {
          gte: new Date(2026, 5, 6, 8, 0, 0, 0),
          lt: new Date(2026, 5, 7, 8, 0, 0, 0),
        },
      },
    });
  });

  it("searches by plate number OR finance weighbridge card number", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    mockPrisma.truckOperation.count.mockResolvedValue(0);

    await listOperations(
      { plateNumber: "4455" },
      { page: 1, pageSize: 25 },
    );

    expect(mockPrisma.truckOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { plateNumber: { contains: "4455", mode: "insensitive" } },
            { externalCardNumber: { contains: "4455", mode: "insensitive" } },
          ],
        },
      }),
    );
  });

  it("floors createdAt at the analytics start even with no date filter", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    mockPrisma.truckOperation.count.mockResolvedValue(0);
    const analyticsStart = new Date(2026, 5, 1, 8, 0, 0, 0);
    mockClampEventWindow.mockResolvedValueOnce({
      from: analyticsStart,
      to: undefined,
      clamped: false,
      analyticsStartDate: "2026-06-01",
    });

    await listOperations({}, { page: 1, pageSize: 25 });

    expect(mockClampEventWindow).toHaveBeenCalledWith(undefined, undefined);
    expect(mockPrisma.truckOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: analyticsStart } },
      }),
    );
  });

  it("raises an explicit dateFrom that reaches before the analytics start", async () => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    mockPrisma.truckOperation.count.mockResolvedValue(0);
    const requestedFrom = new Date(2026, 0, 1, 8, 0, 0, 0);
    const requestedTo = new Date(2026, 6, 1, 8, 0, 0, 0);
    const analyticsStart = new Date(2026, 5, 1, 8, 0, 0, 0);
    mockClampEventWindow.mockResolvedValueOnce({
      from: analyticsStart,
      to: requestedTo,
      clamped: true,
      analyticsStartDate: "2026-06-01",
    });

    await listOperations(
      { dateFrom: requestedFrom, dateTo: requestedTo },
      { page: 1, pageSize: 25 },
    );

    // The service must forward the caller's filters to the clamp…
    expect(mockClampEventWindow).toHaveBeenCalledWith(requestedFrom, requestedTo);
    // …and build the query from the clamped window, not the raw filters.
    expect(mockPrisma.truckOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: analyticsStart, lt: requestedTo } },
      }),
    );
    expect(mockPrisma.truckOperation.count).toHaveBeenCalledWith({
      where: { createdAt: { gte: analyticsStart, lt: requestedTo } },
    });
  });
});

// ─── List Loaded Trucks (owner view) ───────────────────────────────

describe("listLoadedTrucks analytics-start clamping", () => {
  beforeEach(() => {
    mockPrisma.truckOperation.findMany.mockResolvedValue([]);
    mockPrisma.truckOperation.count.mockResolvedValue(0);
  });

  it("floors createdAt at the analytics start when no date filter is sent", async () => {
    const analyticsStart = new Date(2026, 5, 1, 8, 0, 0, 0);
    mockClampEventWindow.mockResolvedValueOnce({
      from: analyticsStart,
      to: undefined,
      clamped: false,
      analyticsStartDate: "2026-06-01",
    });

    await listLoadedTrucks({}, { page: 1, pageSize: 25 });

    expect(mockClampEventWindow).toHaveBeenCalledWith(undefined, undefined);
    expect(mockPrisma.truckOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { not: "Cancelled" },
          createdAt: { gte: analyticsStart },
        },
      }),
    );
  });

  it("raises an explicit dateFrom that reaches before the analytics start", async () => {
    const requestedTo = new Date(2026, 6, 1, 8, 0, 0, 0);
    const analyticsStart = new Date(2026, 5, 1, 8, 0, 0, 0);
    mockClampEventWindow.mockResolvedValueOnce({
      from: analyticsStart,
      to: requestedTo,
      clamped: true,
      analyticsStartDate: "2026-06-01",
    });

    await listLoadedTrucks(
      { dateFrom: new Date(2026, 0, 1, 8, 0, 0, 0), dateTo: requestedTo },
      { page: 1, pageSize: 25 },
    );

    expect(mockPrisma.truckOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { not: "Cancelled" },
          createdAt: { gte: analyticsStart, lt: requestedTo },
        },
      }),
    );
  });

  it("keeps a post-start window untouched", async () => {
    const window = getOperationalDayWindow("2026-06-10");

    await listLoadedTrucks(
      { dateFrom: window.from, dateTo: window.to },
      { page: 1, pageSize: 25 },
    );

    expect(mockPrisma.truckOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { not: "Cancelled" },
          createdAt: { gte: window.from, lt: window.to },
        },
      }),
    );
  });
});

// ─── Update Before Weigh ───────────────────────────────────────

describe("updateTruckBeforeWeigh", () => {
  const queuedTruck = {
    id: 1,
    status: "Queued",
    version: 0,
    customerId: 1,
    destinationId: null,
    plateNumber: "OLD-123",
    driverName: "Old Driver",
    salesOrderNumber: null,
    notes: null,
    operationalGrade: null,
    requestItems: [{ sizeId: 1, bundleCount: 10, requestedTons: null }],
  };

  beforeEach(() => {
    mockPrisma.customer.findUnique.mockResolvedValue({ id: 1, isActive: true });
    mockPrisma.masterContract.findFirst.mockResolvedValue({ contractNumber: "26-90" });
    mockPrisma.sizeLookup.findMany.mockResolvedValue([{ id: 1, isActive: true }]);
    mockPrisma.weighSession.count.mockResolvedValue(0);
    mockPrisma.truckOperation.findFirst.mockResolvedValue(null);
    mockPrisma.truckOperation.update.mockResolvedValue({
      ...queuedTruck,
      version: 1,
      plateNumber: "NEW-123",
      driverName: "New Driver",
    });
    mockPrisma.truckRequestItem.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.truckRequestItem.createMany.mockResolvedValue({ count: 1 });
  });

  it("updates a queued truck, replaces request items, and writes an audit log", async () => {
    mockPrisma.truckOperation.findUnique
      .mockResolvedValueOnce(queuedTruck)
      .mockResolvedValueOnce({
        ...queuedTruck,
        version: 1,
        plateNumber: "NEW-123",
        driverName: "New Driver",
      });

    const result = await updateTruckBeforeWeigh(
      1,
      {
        customerId: 1,
        plateNumber: "NEW-123",
        driverName: "New Driver",
        requestItems: [{ sizeId: 1, bundleCount: 12 }],
      },
      0,
      7,
    );

    expect(result?.version).toBe(1);
    expect(mockPrisma.truckOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          plateNumber: "NEW-123",
          driverName: "New Driver",
          version: { increment: 1 },
        }),
      }),
    );
    expect(mockPrisma.truckRequestItem.deleteMany).toHaveBeenCalledWith({
      where: { truckOperationId: 1 },
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.auditLog.create.mock.calls[0][0].data.details.event).toBe(
      "truck_updated_before_weigh",
    );
  });

  it("allows FirstWeigh edits before any internal session", async () => {
    const firstWeighTruck = {
      ...queuedTruck,
      status: "FirstWeigh",
      tareWeightKg: 12000,
      driverName: "Old Driver",
    };
    mockPrisma.truckOperation.findUnique
      .mockResolvedValueOnce(firstWeighTruck)
      .mockResolvedValueOnce({
        ...firstWeighTruck,
        version: 1,
        driverName: "New Driver",
      });
    mockPrisma.truckOperation.update.mockResolvedValue({
      ...firstWeighTruck,
      version: 1,
      driverName: "New Driver",
    });

    const result = await updateTruckBeforeWeigh(
      1,
      {
        driverName: "New Driver",
        requestItems: [{ sizeId: 1, bundleCount: 12 }],
      },
      0,
      7,
    );

    expect(result?.driverName).toBe("New Driver");
    expect(mockPrisma.weighSession.count).toHaveBeenCalled();
    expect(mockPrisma.auditLog.create.mock.calls[0][0].data.details.event).toBe(
      "truck_updated_after_tare",
    );
  });

  it("rejects FirstWeigh edits once internal sessions exist", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValueOnce({
      ...queuedTruck,
      status: "FirstWeigh",
    });
    mockPrisma.weighSession.count.mockResolvedValueOnce(1);

    await expect(
      updateTruckBeforeWeigh(1, { requestItems: [{ sizeId: 1, bundleCount: 12 }] }, 0, 7),
    ).rejects.toThrow("cannotEditTruckAfterInternalWeighs");
    expect(mockPrisma.truckOperation.update).not.toHaveBeenCalled();
  });

  it("rejects changing plate after tare", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValueOnce({
      ...queuedTruck,
      status: "FirstWeigh",
    });

    await expect(
      updateTruckBeforeWeigh(1, { plateNumber: "NEW-999" }, 0, 7),
    ).rejects.toThrow("afterTareLimitedFieldsEditable");
  });

  it("rejects changing customer after tare", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValueOnce({
      ...queuedTruck,
      status: "FirstWeigh",
    });

    await expect(
      updateTruckBeforeWeigh(1, { customerId: 2 }, 0, 7),
    ).rejects.toThrow("afterTareLimitedFieldsEditable");
  });

  it("clears notes at FirstWeigh when patch sends null", async () => {
    const firstWeighTruck = {
      ...queuedTruck,
      status: "FirstWeigh",
      notes: "ملاحظة قديمة",
    };
    mockPrisma.truckOperation.findUnique
      .mockResolvedValueOnce(firstWeighTruck)
      .mockResolvedValueOnce({ ...firstWeighTruck, version: 1, notes: null });
    mockPrisma.truckOperation.update.mockResolvedValue({
      ...firstWeighTruck,
      version: 1,
      notes: null,
    });

    await updateTruckBeforeWeigh(1, { notes: null }, 0, 7);

    expect(mockPrisma.truckOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ notes: null }),
      }),
    );
  });

  it("leaves operationalGrade unchanged when omitted from patch at FirstWeigh", async () => {
    const firstWeighTruck = {
      ...queuedTruck,
      status: "FirstWeigh",
      operationalGrade: "FIRST" as const,
      driverName: "Old Driver",
    };
    mockPrisma.truckOperation.findUnique
      .mockResolvedValueOnce(firstWeighTruck)
      .mockResolvedValueOnce({
        ...firstWeighTruck,
        version: 1,
        driverName: "New Driver",
      });
    mockPrisma.truckOperation.update.mockResolvedValue({
      ...firstWeighTruck,
      version: 1,
      driverName: "New Driver",
    });

    await updateTruckBeforeWeigh(1, { driverName: "New Driver" }, 0, 7);

    const updateArg = mockPrisma.truckOperation.update.mock.calls[0][0];
    expect(updateArg.data).not.toHaveProperty("operationalGrade");
    expect(updateArg.data).toMatchObject({ driverName: "New Driver" });
  });

  it("rejects edits once truck is OnScale", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValueOnce({
      ...queuedTruck,
      status: "OnScale",
    });

    await expect(
      updateTruckBeforeWeigh(1, { requestItems: [{ sizeId: 1, bundleCount: 12 }] }, 0, 7),
    ).rejects.toThrow("cannotEditTruckAfterInternalWeighs");
    expect(mockPrisma.truckOperation.update).not.toHaveBeenCalled();
  });

  it("rejects changing a queued truck to a plate with another open operation", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValueOnce(queuedTruck);
    mockPrisma.truckOperation.findFirst.mockResolvedValueOnce({
      id: 99,
      status: "Queued",
    });

    await expect(
      updateTruckBeforeWeigh(
        1,
        { customerId: 1, plateNumber: "DUP-123", driverName: "Driver" },
        0,
        7,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mockPrisma.truckOperation.update).not.toHaveBeenCalled();
  });
});

// ─── Update Notes (mid-weighing) ───────────────────────────────

describe("updateTruckNotes", () => {
  const onScaleTruck = {
    id: 1,
    status: "OnScale",
    version: 3,
    notes: "قديمة",
  };

  it.each(["OnScale", "LoadingComplete", "SecondWeigh"] as const)(
    "updates notes and writes an audit log for %s",
    async (status) => {
      const truck = { ...onScaleTruck, status };
      mockPrisma.truckOperation.findUnique
        .mockResolvedValueOnce({ ...truck })
        .mockResolvedValueOnce({ ...truck, version: 4, notes: "جديدة" });
      mockPrisma.truckOperation.update.mockResolvedValue({
        ...truck,
        version: 4,
        notes: "جديدة",
      });

      const result = await updateTruckNotes(1, "  جديدة  ", 3, 7);

      expect(result?.notes).toBe("جديدة");
      expect(mockPrisma.truckOperation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { notes: "جديدة", version: { increment: 1 } },
        }),
      );
      expect(mockPrisma.auditLog.create.mock.calls[0][0].data.details.event).toBe(
        "truck_notes_updated",
      );
    },
  );

  it("clears notes when passed null", async () => {
    mockPrisma.truckOperation.findUnique
      .mockResolvedValueOnce({ ...onScaleTruck })
      .mockResolvedValueOnce({ ...onScaleTruck, version: 4, notes: null });
    mockPrisma.truckOperation.update.mockResolvedValue({
      ...onScaleTruck,
      version: 4,
      notes: null,
    });

    await updateTruckNotes(1, null, 3, 7);

    expect(mockPrisma.truckOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { notes: null, version: { increment: 1 } },
      }),
    );
  });

  it("rejects when the status is not a mid-weighing status", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValueOnce({
      ...onScaleTruck,
      status: "Completed",
    });

    await expect(updateTruckNotes(1, "x", 3, 7)).rejects.toThrow(
      "cannotEditNotesInCurrentStatus",
    );
    expect(mockPrisma.truckOperation.update).not.toHaveBeenCalled();
  });

  it("rejects on a version mismatch", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValueOnce({
      ...onScaleTruck,
      version: 5,
    });

    await expect(updateTruckNotes(1, "x", 3, 7)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(mockPrisma.truckOperation.update).not.toHaveBeenCalled();
  });
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
    await expect(registerTruck(validInput, 7)).rejects.toThrow(
      "cannotRegisterTruckWithoutActiveGeneralContract",
    );
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
      roundNumber: 1,
    });
  });

  it("opens bridge round 1 at the tare weight and adopts pre-tare photos", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValueOnce({
      id: 1,
      status: "Queued",
      tareWeightKg: null,
      operationalGrade: "FIRST",
    });
    mockPrisma.bridgeRound.create.mockResolvedValueOnce({ id: 77, roundNumber: 1 });

    await enterTare(1, 10_000, 5);

    expect(mockPrisma.bridgeRound.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        truckOperationId: 1,
        roundNumber: 1,
        grade: "FIRST",
        startWeightKg: 10_000,
      }),
    });
    // Photos uploaded while Queued have no round; round 1 adopts them.
    expect(mockPrisma.truckPhoto.updateMany).toHaveBeenCalledWith({
      where: { truckOperationId: 1, bridgeRoundId: null },
      data: { bridgeRoundId: 77 },
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
    mockRounds({ open: { id: 11, roundNumber: 1, grade: null } });
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
    await expect(confirmLoadingComplete(1, 99)).rejects.toThrow(
      "atLeastOneWeighBeforeLoadingComplete",
    );
  });

  it("refuses when no photo uploaded", async () => {
    mockPrisma.truckPhoto.count.mockResolvedValueOnce(0);
    await expect(confirmLoadingComplete(1, 99)).rejects.toThrow(
      "atLeastOnePhotoBeforeLoadingComplete",
    );
  });

  it("scopes session/photo requirements to the OPEN round, not the whole operation", async () => {
    await confirmLoadingComplete(1, 99);

    expect(mockPrisma.weighSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { bridgeRoundId: 11 } }),
    );
    expect(mockPrisma.truckPhoto.count).toHaveBeenCalledWith({
      where: { bridgeRoundId: 11 },
    });
  });

  it("stamps the loader confirmation and chosen grade onto the round", async () => {
    await confirmLoadingComplete(1, 99, "SECOND");

    expect(mockPrisma.bridgeRound.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({
        loaderId: 99,
        loadingConfirmedAt: expect.any(Date),
        grade: "SECOND",
      }),
    });
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.newValue.roundNumber).toBe(1);
    expect(audit.data.details.newValue.roundGrade).toBe("SECOND");
  });

  it("keeps the round's existing grade when none is passed", async () => {
    mockRounds({ open: { id: 11, roundNumber: 2, grade: "FIRST" } });

    await confirmLoadingComplete(1, 99);

    expect(mockPrisma.bridgeRound.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({ grade: "FIRST" }),
    });
  });

  it("refuses when no open round exists", async () => {
    mockRounds({ open: null });
    await expect(confirmLoadingComplete(1, 99)).rejects.toThrow("noOpenScaleRound");
  });
});

// ─── 3b. Loader confirmation — exempt trucks (scrap / billet wire) ──

describe("confirmLoadingComplete — internal-weighing-exempt trucks", () => {
  beforeEach(() => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "FirstWeigh",
      loadingConfirmedAt: null,
      loaderId: null,
      skipInternalWeighing: true,
    });
    mockRounds({ open: { id: 11, roundNumber: 1, grade: null, sizeId: null } });
    // Exempt trucks have no internal sessions but still require a photo.
    mockPrisma.weighSession.findMany.mockResolvedValue([]);
    mockPrisma.truckPhoto.count.mockResolvedValue(1);
    mockPrisma.truckOperation.update.mockResolvedValue({
      id: 1,
      status: "LoadingComplete",
    });
  });

  it("auto-attributes the round to the single request material", async () => {
    mockPrisma.truckRequestItem.findMany.mockResolvedValue([{ sizeId: 5 }]);

    await confirmLoadingComplete(1, 99);

    expect(mockPrisma.bridgeRound.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({ sizeId: 5 }),
    });
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.newValue.roundSizeId).toBe(5);
  });

  it("requires an explicit material when the truck carries several exempt materials", async () => {
    mockPrisma.truckRequestItem.findMany.mockResolvedValue([
      { sizeId: 5 },
      { sizeId: 7 },
    ]);

    await expect(confirmLoadingComplete(1, 99)).rejects.toThrow(
      "multiMaterialRoundMaterialRequired",
    );
  });

  it("stamps the loader's chosen material onto the round", async () => {
    mockPrisma.truckRequestItem.findMany.mockResolvedValue([
      { sizeId: 5 },
      { sizeId: 7 },
    ]);

    await confirmLoadingComplete(1, 99, undefined, 7);

    expect(mockPrisma.bridgeRound.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({ sizeId: 7 }),
    });
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.newValue.roundSizeId).toBe(7);
  });

  it("rejects a material that is not on the truck's request items", async () => {
    mockPrisma.truckRequestItem.findMany.mockResolvedValue([
      { sizeId: 5 },
      { sizeId: 7 },
    ]);

    await expect(confirmLoadingComplete(1, 99, undefined, 9)).rejects.toThrow(
      "roundMaterialMustBeInRequestItems",
    );
  });

  it("keeps the round's previously chosen material on re-confirm after reopen", async () => {
    mockPrisma.truckRequestItem.findMany.mockResolvedValue([
      { sizeId: 5 },
      { sizeId: 7 },
    ]);
    mockRounds({ open: { id: 11, roundNumber: 1, grade: null, sizeId: 7 } });

    await confirmLoadingComplete(1, 99);

    expect(mockPrisma.bridgeRound.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({ sizeId: 7 }),
    });
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
    mockRounds({
      open: { id: 11, roundNumber: 1, grade: null, startWeightKg: 10_000 },
    });
    mockPrisma.weighSession.findMany.mockResolvedValue([{ weightTons: 15.05 }]);
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

  it("stamps cross-verification discrepancy fields into gross_recorded audit", async () => {
    await enterGross(1, 25_300, 7);

    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.newValue.discrepancyKg).toBe(250);
    expect(audit.data.details.newValue.discrepancyWarning).toBe(true);
    expect(audit.data.details.newValue.internalTotalTons).toBe(15.05);
    expect(audit.data.details.newValue.bridgeNetKg).toBe(15_300);
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
      "loadingMustBeConfirmedBeforeGross",
    );
    expect(mockPrisma.truckOperation.update).not.toHaveBeenCalled();
  });

  it("rejects gross <= round start weight (weight integrity)", async () => {
    await expect(enterGross(1, 10_000, 7)).rejects.toThrow(
      "grossMustExceedRoundStart",
    );
    await expect(enterGross(1, 9_999, 7)).rejects.toThrow(
      "grossMustExceedRoundStart",
    );
  });

  it("closes round 1 as final and marks it isFinal on exit", async () => {
    await enterGross(1, 25_000, 7);

    expect(mockPrisma.bridgeRound.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({
        endWeightKg: 25_000,
        isFinal: true,
      }),
    });
    // Final exit never opens a next round.
    expect(mockPrisma.bridgeRound.create).not.toHaveBeenCalled();
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

// ─── Gross on exempt trucks: mirror session attribution ────────

describe("enterGross — exempt truck mirror session", () => {
  beforeEach(() => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "LoadingComplete",
      tareWeightKg: 10_000,
      grossWeightKg: null,
      loadingConfirmedAt: new Date("2026-07-02T08:00:00Z"),
      loaderId: 99,
      skipInternalWeighing: true,
    });
    mockPrisma.weighSession.count.mockResolvedValue(0);
    mockPrisma.weighSession.findFirst.mockResolvedValue(null);
    mockPrisma.weighSession.create.mockResolvedValue({});
    mockPrisma.weighSession.findMany.mockResolvedValue([{ weightTons: 15 }]);
    mockPrisma.truckOperation.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data }),
    );
  });

  it("attributes the mirror session to the ROUND's material when set", async () => {
    mockRounds({
      open: { id: 11, roundNumber: 2, grade: null, sizeId: 7, startWeightKg: 10_000 },
    });

    await enterGross(1, 25_000, 3);

    const created = mockPrisma.weighSession.create.mock.calls[0][0];
    expect(created.data.sizeId).toBe(7);
    expect(created.data.bridgeRoundId).toBe(11);
    // Net = (25_000 − 10_000) / 1000 tons.
    expect(created.data.weightTons).toBe("15.000");
    // The chosen material makes the fallback lookup unnecessary.
    expect(mockPrisma.truckRequestItem.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the first request item for legacy rounds without a material", async () => {
    mockRounds({
      open: { id: 11, roundNumber: 1, grade: null, sizeId: null, startWeightKg: 10_000 },
    });
    mockPrisma.truckRequestItem.findFirst.mockResolvedValue({ sizeId: 5 });

    await enterGross(1, 25_000, 3);

    const created = mockPrisma.weighSession.create.mock.calls[0][0];
    expect(created.data.sizeId).toBe(5);
  });
});

// ─── Multi-round: weigh-and-return cycle ───────────────────────

describe("enterGross — exit='return' (multi-round)", () => {
  beforeEach(() => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "LoadingComplete",
      tareWeightKg: 10_000,
      grossWeightKg: null,
      loadingConfirmedAt: new Date("2026-06-10T08:00:00Z"),
      loaderId: 99,
    });
    mockRounds({
      open: { id: 11, roundNumber: 1, grade: "FIRST", startWeightKg: 10_000 },
    });
    mockPrisma.weighSession.findMany.mockResolvedValue([{ weightTons: 15 }]);
    mockPrisma.truckOperation.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 1,
        ...data,
      }),
    );
    mockPrisma.bridgeRound.create.mockResolvedValue({ id: 12, roundNumber: 2 });
  });

  it("closes the round (not final), opens the next round chained at this weighing, and resets to FirstWeigh", async () => {
    await enterGross(1, 25_000, 7, "return");

    // Round 1 closed but NOT final.
    expect(mockPrisma.bridgeRound.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({ endWeightKg: 25_000, isFinal: false }),
    });
    // Round 2 opens at exactly the round-1 end weight — copied by the
    // service, never typed by an operator.
    expect(mockPrisma.bridgeRound.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        truckOperationId: 1,
        roundNumber: 2,
        grade: null,
        startWeightKg: 25_000,
      }),
    });
    // Operation-level gross stays empty — only the FINAL weighing sets it.
    const opUpdate = mockPrisma.truckOperation.update.mock.calls[0][0];
    expect(opUpdate.data.status).toBe("FirstWeigh");
    expect(opUpdate.data).not.toHaveProperty("grossWeightKg");
    // Two-role rule re-arms for the new round: loader must confirm again.
    expect(opUpdate.data.loadingConfirmedAt).toBeNull();
    expect(opUpdate.data.loaderId).toBeNull();
  });

  it("writes round_weighed_return audit with per-round net and next round number", async () => {
    await enterGross(1, 25_000, 7, "return");

    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.event).toBe("round_weighed_return");
    expect(audit.data.details.newValue).toMatchObject({
      status: "FirstWeigh",
      roundNumber: 1,
      roundGrade: "FIRST",
      roundStartWeightKg: 10_000,
      roundEndWeightKg: 25_000,
      roundNetKg: 15_000,
      nextRoundNumber: 2,
    });
    expect(audit.data.details.newValue).not.toHaveProperty("netWeightKg");
  });

  it("validates against the ROUND start weight, not the original tare (round 2+)", async () => {
    // Round 2: truck already carries 15t — bridge shows 25_000 going in.
    mockRounds({
      open: { id: 12, roundNumber: 2, grade: null, startWeightKg: 25_000 },
    });

    // 24_000 is far above the 10_000 tare but BELOW the round start — must fail.
    await expect(enterGross(1, 24_000, 7, "return")).rejects.toThrow(
      "grossMustExceedRoundStart",
    );
    expect(mockPrisma.bridgeRound.update).not.toHaveBeenCalled();
  });

  it("computes per-round discrepancy from the round's own sessions and start weight", async () => {
    // Round 2 starts at 25_000; internal sessions for THIS round total 5.05t;
    // bridge says 30_300 → bridge net 5_300 vs internal 5_050 → 250 kg gap.
    mockRounds({
      open: { id: 12, roundNumber: 2, grade: "SECOND", startWeightKg: 25_000 },
    });
    mockPrisma.weighSession.findMany.mockResolvedValue([{ weightTons: 5.05 }]);

    await enterGross(1, 30_300, 7, "return");

    expect(mockPrisma.weighSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { bridgeRoundId: 12 } }),
    );
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.newValue.bridgeNetKg).toBe(5_300);
    expect(audit.data.details.newValue.discrepancyKg).toBe(250);
    expect(audit.data.details.newValue.discrepancyWarning).toBe(true);
  });

  it("final exit on a later round records operation gross = last weighing", async () => {
    mockRounds({
      open: { id: 12, roundNumber: 2, grade: null, startWeightKg: 25_000 },
    });
    mockPrisma.weighSession.findMany.mockResolvedValue([{ weightTons: 5 }]);

    await enterGross(1, 30_000, 7, "final");

    expect(mockPrisma.bridgeRound.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: expect.objectContaining({ endWeightKg: 30_000, isFinal: true }),
    });
    const opUpdate = mockPrisma.truckOperation.update.mock.calls[0][0];
    expect(opUpdate.data.grossWeightKg).toBe(30_000);
    expect(opUpdate.data.status).toBe("SecondWeigh");

    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.event).toBe("gross_recorded");
    // Operation net spans the WHOLE visit (final gross - original tare)…
    expect(audit.data.details.newValue.netWeightKg).toBe(20_000);
    // …while the round net covers only this round.
    expect(audit.data.details.newValue.roundNetKg).toBe(5_000);
  });

  it("still requires loader confirmation before a return weighing", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "OnScale",
      tareWeightKg: 10_000,
      grossWeightKg: null,
      loadingConfirmedAt: null,
      loaderId: null,
    });

    await expect(enterGross(1, 25_000, 7, "return")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

// ─── Multi-round: tare correction freeze ───────────────────────

describe("correctTare — round chain protection", () => {
  beforeEach(() => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "OnScale",
      tareWeightKg: 10_000,
      version: 3,
    });
    mockPrisma.truckOperation.updateMany.mockResolvedValue({ count: 1 });
  });

  it("corrects tare and keeps round 1's start weight in sync", async () => {
    mockRounds({ open: { id: 11, roundNumber: 1 }, lastClosed: null });

    await correctTare(1, 9_800, 3, 7);

    expect(mockPrisma.bridgeRound.updateMany).toHaveBeenCalledWith({
      where: { truckOperationId: 1, roundNumber: 1 },
      data: expect.objectContaining({ startWeightKg: 9_800 }),
    });
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.action).toBe("tare_correction");
    expect(audit.data.details.newTareWeightKg).toBe(9_800);
  });

  it("refuses once any round is closed — the tare is chained into later rounds", async () => {
    mockRounds({
      open: { id: 12, roundNumber: 2, startWeightKg: 25_000 },
      lastClosed: { id: 11, roundNumber: 1, endWeightKg: 25_000 },
    });

    await expect(correctTare(1, 9_800, 3, 7)).rejects.toThrow(
      "cannotCorrectTareAfterExternalWeigh",
    );
    expect(mockPrisma.truckOperation.updateMany).not.toHaveBeenCalled();
  });
});

// ─── Multi-round: gross correction targets the last closed round ──

describe("correctGross — last closed round", () => {
  beforeEach(() => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "SecondWeigh",
      tareWeightKg: 10_000,
      grossWeightKg: 30_000,
      version: 5,
    });
    mockPrisma.truckOperation.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.weighSession.findMany.mockResolvedValue([{ weightTons: 5 }]);
  });

  it("corrects a FINAL round: updates the round AND the operation gross", async () => {
    mockRounds({
      lastClosed: {
        id: 12,
        roundNumber: 2,
        startWeightKg: 25_000,
        endWeightKg: 30_000,
        isFinal: true,
      },
    });

    await correctGross(1, 30_500, 5, 7);

    expect(mockPrisma.truckOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1, version: 5 },
        data: expect.objectContaining({ grossWeightKg: 30_500 }),
      }),
    );
    expect(mockPrisma.bridgeRound.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: expect.objectContaining({ endWeightKg: 30_500 }),
    });
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.action).toBe("gross_correction");
    expect(audit.data.details.roundNumber).toBe(2);
    expect(audit.data.details.isFinalRound).toBe(true);
    expect(audit.data.details.oldGrossWeightKg).toBe(30_000);
    expect(audit.data.details.newGrossWeightKg).toBe(30_500);
  });

  it("corrects a MID-VISIT round and cascades the new end weight into the next round's start", async () => {
    // Truck is back inside loading round 2; round 1's weighing was mistyped.
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "OnScale",
      tareWeightKg: 10_000,
      grossWeightKg: null,
      version: 5,
    });
    mockRounds({
      lastClosed: {
        id: 11,
        roundNumber: 1,
        startWeightKg: 10_000,
        endWeightKg: 25_000,
        isFinal: false,
      },
    });
    mockPrisma.bridgeRound.updateMany.mockResolvedValue({ count: 1 });

    await correctGross(1, 24_700, 5, 7);

    // Operation gross untouched (no final weighing yet) — version bump only.
    const opUpdate = mockPrisma.truckOperation.updateMany.mock.calls[0][0];
    expect(opUpdate.data).not.toHaveProperty("grossWeightKg");
    expect(opUpdate.data.version).toEqual({ increment: 1 });
    // The chain stays intact: round 2 now starts at the corrected weight.
    expect(mockPrisma.bridgeRound.updateMany).toHaveBeenCalledWith({
      where: { truckOperationId: 1, roundNumber: 2 },
      data: { startWeightKg: 24_700 },
    });
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.cascadedToNextRound).toBe(true);
    expect(audit.data.details.isFinalRound).toBe(false);
  });

  it("rejects a correction at or below the round's start weight", async () => {
    mockRounds({
      lastClosed: {
        id: 12,
        roundNumber: 2,
        startWeightKg: 25_000,
        endWeightKg: 30_000,
        isFinal: true,
      },
    });

    await expect(correctGross(1, 25_000, 5, 7)).rejects.toThrow(
      "grossMustExceedRoundStart",
    );
    expect(mockPrisma.truckOperation.updateMany).not.toHaveBeenCalled();
  });

  it("refuses when no external weighing exists yet", async () => {
    mockRounds({ open: { id: 11, roundNumber: 1 }, lastClosed: null });

    await expect(correctGross(1, 25_000, 5, 7)).rejects.toThrow(
      "noExternalWeighToCorrect",
    );
  });
});

// ─── Multi-round: closed-round sessions are frozen ─────────────

describe("weigh sessions of closed rounds are immutable", () => {
  const oldRoundSession = {
    id: 10,
    truckOperationId: 1,
    bridgeRoundId: 11, // belongs to round 1 (closed)
    sessionNumber: 1,
    sizeId: 3,
    bundleCount: 5,
    weightTons: 6,
    version: 1,
  };

  beforeEach(() => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "OnScale",
    });
    // Round 2 is now open; the session above belongs to closed round 1.
    mockRounds({ open: { id: 12, roundNumber: 2 } });
    mockPrisma.weighSession.findUnique.mockResolvedValue(oldRoundSession);
  });

  it("rejects editing a session from a previous round", async () => {
    await expect(
      editWeighSession(1, 10, 1, { weightTons: 7 }, 7),
    ).rejects.toThrow("cannotEditWeighOfPreviousRoundAfterExternal");
  });

  it("rejects deleting a session from a previous round", async () => {
    await expect(deleteWeighSession(1, 10, 1, 7)).rejects.toThrow(
      "cannotDeleteWeighOfPreviousRoundAfterExternal",
    );
    expect(mockPrisma.weighSession.deleteMany).not.toHaveBeenCalled();
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
      expect((e as ServiceError).message).toBe("openTruckForPlateById");
    }

    expect(mockPrisma.truckOperation.create).not.toHaveBeenCalled();
  });
});

// ─── 10. Cancel session ───────────────────────────────────────

// ─── Close Operation (requires finance card number) ────────────

describe("closeOperation", () => {
  const secondWeighTruck = {
    id: 1,
    status: "SecondWeigh",
    tareWeightKg: 12_000,
    grossWeightKg: 25_000,
    sessions: [{ weightTons: 12.8 }],
    rounds: [
      {
        roundNumber: 1,
        grade: "FIRST",
        sizeId: null,
        startWeightKg: 12_000,
        endWeightKg: 25_000,
      },
    ],
  };

  beforeEach(() => {
    mockPrisma.truckOperation.findUnique.mockImplementation(
      async (args: { where: { id?: number; externalCardNumber?: string } }) => {
        if (args.where.externalCardNumber != null) return null;
        if (args.where.id === 1) return secondWeighTruck;
        return null;
      },
    );
    mockPrisma.truckOperation.update.mockResolvedValue({
      id: 1,
      status: "Completed",
      externalCardNumber: "WB-1001",
      closedById: 7,
    });
  });

  it("refuses to close without a card number (empty / whitespace)", async () => {
    await expect(closeOperation(1, 7, "")).rejects.toThrow(
      "weighbridgeCardRequiredToClose",
    );
    await expect(closeOperation(1, 7, "   ")).rejects.toThrow(
      "weighbridgeCardRequiredToClose",
    );
    expect(mockPrisma.truckOperation.update).not.toHaveBeenCalled();
  });

  it("closes SecondWeigh → Completed, stores trimmed card number, writes audit", async () => {
    const result = await closeOperation(1, 7, "  WB-1001  ");

    expect(result.status).toBe("Completed");
    const updateCall = mockPrisma.truckOperation.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("Completed");
    expect(updateCall.data.externalCardNumber).toBe("WB-1001");
    expect(updateCall.data.closedById).toBe(7);
    expect(updateCall.data.closedAt).toBeInstanceOf(Date);

    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.from).toBe("SecondWeigh");
    expect(audit.data.details.to).toBe("Completed");
    expect(audit.data.details.externalCardNumber).toBe("WB-1001");
    expect(audit.data.details.bridgeNetKg).toBe(13_000);
  });

  it("rejects a card number already used by another operation", async () => {
    mockPrisma.truckOperation.findUnique.mockImplementation(
      async (args: { where: { id?: number; externalCardNumber?: string } }) => {
        if (args.where.externalCardNumber === "WB-1001") {
          return { id: 99 };
        }
        if (args.where.id === 1) return secondWeighTruck;
        return null;
      },
    );

    await expect(closeOperation(1, 7, "WB-1001")).rejects.toThrow(
      "weighbridgeCardAlreadyUsed",
    );
    expect(mockPrisma.truckOperation.update).not.toHaveBeenCalled();
  });

  it("refuses close when status is not SecondWeigh", async () => {
    mockPrisma.truckOperation.findUnique.mockImplementation(
      async (args: { where: { id?: number; externalCardNumber?: string } }) => {
        if (args.where.externalCardNumber != null) return null;
        return { ...secondWeighTruck, status: "LoadingComplete" };
      },
    );

    await expect(closeOperation(1, 7, "WB-1001")).rejects.toThrow(ServiceError);
    expect(mockPrisma.truckOperation.update).not.toHaveBeenCalled();
  });

  it("refuses close when tare or gross is missing", async () => {
    mockPrisma.truckOperation.findUnique.mockImplementation(
      async (args: { where: { id?: number; externalCardNumber?: string } }) => {
        if (args.where.externalCardNumber != null) return null;
        return { ...secondWeighTruck, grossWeightKg: null };
      },
    );

    await expect(closeOperation(1, 7, "WB-1001")).rejects.toThrow(
      "tareAndGrossRequiredBeforeClose",
    );
  });
});

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
    await expect(cancelOperation(1, "   ", 7)).rejects.toThrow(
      "cancelReasonRequired",
    );
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
    expect(updateCall.data.lastReopenedAt).toBeInstanceOf(Date);

    // The open round's confirmation is reset in lock-step with the operation.
    expect(mockPrisma.bridgeRound.updateMany).toHaveBeenCalledWith({
      where: { truckOperationId: 1, endWeightKg: null },
      data: expect.objectContaining({
        loadingConfirmedAt: null,
        loaderId: null,
      }),
    });

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
    await expect(reopenBeforeGross(1, 7)).rejects.toThrow(
      "reopenOnlyFromLoadingComplete",
    );
  });
});

// ─── Delete internal weigh session ─────────────────────────────

describe("deleteWeighSession", () => {
  const weighRow = {
    id: 10,
    truckOperationId: 1,
    bridgeRoundId: 11,
    sessionNumber: 2,
    sizeId: 3,
    bundleCount: 5,
    weightTons: 6.12,
    version: 1,
  };

  beforeEach(() => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "OnScale",
    });
    mockRounds({ open: { id: 11, roundNumber: 1 } });
    mockPrisma.weighSession.findUnique.mockResolvedValue(weighRow);
    mockPrisma.weighSession.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.weighSession.count.mockResolvedValue(1);
  });

  it("deletes a session on OnScale and writes audit", async () => {
    const result = await deleteWeighSession(1, 10, 1, 7);

    expect(result.truckStatus).toBe("OnScale");
    expect(mockPrisma.weighSession.deleteMany).toHaveBeenCalledWith({
      where: { id: 10, version: 1 },
    });
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.action).toBe("delete");
    expect(audit.data.entityType).toBe("WeighSession");
    expect(audit.data.details.deleted.sessionNumber).toBe(2);
  });

  it("reverts truck status to FirstWeigh when the last session is deleted", async () => {
    mockPrisma.weighSession.count.mockResolvedValue(0);
    mockPrisma.truckOperation.update.mockResolvedValue({ id: 1, status: "FirstWeigh" });

    const result = await deleteWeighSession(1, 10, 1, 7);

    expect(result.truckStatus).toBe("FirstWeigh");
    expect(mockPrisma.truckOperation.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: "FirstWeigh" },
    });
  });

  it("rejects delete after loading complete", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "LoadingComplete",
    });

    await expect(deleteWeighSession(1, 10, 1, 7)).rejects.toThrow(
      "cannotDeleteWeighsAfterLoadingComplete",
    );
    expect(mockPrisma.weighSession.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects stale expectedVersion", async () => {
    mockPrisma.weighSession.deleteMany.mockResolvedValue({ count: 0 });

    await expect(deleteWeighSession(1, 10, 1, 7)).rejects.toThrow(
      "weighModifiedByAnotherUser",
    );
  });
});
