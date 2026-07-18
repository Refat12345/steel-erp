/**
 * Admin post-close correction tests (permission `scale.correct_completed`).
 *
 * These cover the dedicated correction functions that operate on a
 * `Completed` truck WITHOUT ever changing its status, on an explicit round,
 * with a mandatory reason and full audit trail. Scrap / billet-wire
 * (`skipInternalWeighing`) trucks refuse manual session edits.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  sizeLookup: { findUnique: vi.fn() },
  truckOperation: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  bridgeRound: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  weighSession: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./tx-retry", () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
}));

import {
  correctCompletedRoundGrade,
  correctCompletedTare,
  correctCompletedExternalCardNumber,
  correctCompletedRoundExternal,
  addCompletedSession,
  editCompletedSession,
  deleteCompletedSession,
} from "./truck.service";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    typeof fn === "function" ? fn(mockPrisma) : fn,
  );
  mockPrisma.$queryRaw.mockResolvedValue([{ id: 1 }]);
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.bridgeRound.update.mockResolvedValue({});
  mockPrisma.bridgeRound.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.truckOperation.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.weighSession.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.weighSession.deleteMany.mockResolvedValue({ count: 1 });
  mockPrisma.weighSession.findMany.mockResolvedValue([]);
  mockPrisma.truckOperation.update.mockResolvedValue({});
  mockPrisma.bridgeRound.findMany.mockResolvedValue([]);
});

// ─── Grade correction ──────────────────────────────────────────

describe("correctCompletedRoundGrade", () => {
  beforeEach(() => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "Completed",
      operationalGrade: "FIRST",
      salesOrder: null,
    });
    mockPrisma.bridgeRound.findUnique.mockResolvedValue({
      id: 11,
      truckOperationId: 1,
      roundNumber: 1,
      grade: "FIRST",
      version: 0,
    });
    mockPrisma.bridgeRound.updateMany.mockResolvedValue({ count: 1 });
    // After the update the single round is SECOND.
    mockPrisma.bridgeRound.findMany.mockResolvedValue([{ grade: "SECOND" }]);
  });

  it("updates the round grade and audits with reason", async () => {
    await correctCompletedRoundGrade(1, 11, "SECOND", "خطأ إدخال نخب", 0, 7);

    expect(mockPrisma.bridgeRound.updateMany).toHaveBeenCalledWith({
      where: { id: 11, version: 0 },
      data: { grade: "SECOND", version: { increment: 1 } },
    });
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.event).toBe("completed_grade_corrected");
    expect(audit.data.details.oldGrade).toBe("FIRST");
    expect(audit.data.details.newGrade).toBe("SECOND");
    expect(audit.data.details.reason).toBe("خطأ إدخال نخب");
  });

  it("syncs operationalGrade when all rounds share the corrected grade", async () => {
    await correctCompletedRoundGrade(1, 11, "SECOND", "x", 0, 7);
    expect(mockPrisma.truckOperation.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { operationalGrade: "SECOND" },
    });
  });

  it("leaves operationalGrade untouched for mixed multi-round visits", async () => {
    mockPrisma.bridgeRound.findMany.mockResolvedValue([
      { grade: "FIRST" },
      { grade: "SECOND" },
    ]);
    await correctCompletedRoundGrade(1, 11, "SECOND", "x", 0, 7);
    expect(mockPrisma.truckOperation.update).not.toHaveBeenCalled();
  });

  it("does not sync operationalGrade when a sales order drives the grade", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "Completed",
      operationalGrade: "FIRST",
      salesOrder: { grade: "FIRST" },
    });
    await correctCompletedRoundGrade(1, 11, "SECOND", "x", 0, 7);
    expect(mockPrisma.truckOperation.update).not.toHaveBeenCalled();
  });

  it("rejects when the truck is not Completed", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "OnScale",
      operationalGrade: "FIRST",
      salesOrder: null,
    });
    await expect(
      correctCompletedRoundGrade(1, 11, "SECOND", "x", 0, 7),
    ).rejects.toThrow("adminCorrectionOnlyForCompletedTrucks");
    expect(mockPrisma.bridgeRound.updateMany).not.toHaveBeenCalled();
  });

  it("raises a conflict when the round version moved", async () => {
    mockPrisma.bridgeRound.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      correctCompletedRoundGrade(1, 11, "SECOND", "x", 0, 7),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

// ─── Tare correction ───────────────────────────────────────────

describe("correctCompletedTare", () => {
  beforeEach(() => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "Completed",
      tareWeightKg: 13_500,
      skipInternalWeighing: false,
    });
    mockPrisma.bridgeRound.findFirst.mockResolvedValue({
      id: 11,
      truckOperationId: 1,
      roundNumber: 1,
      startWeightKg: 13_500,
      endWeightKg: 30_000,
    });
  });

  it("updates tare and round 1 start without touching later rounds", async () => {
    await correctCompletedTare(1, 13_200, "خطأ فارغ", 0, 7);

    expect(mockPrisma.truckOperation.updateMany).toHaveBeenCalledWith({
      where: { id: 1, version: 0 },
      data: expect.objectContaining({ tareWeightKg: 13_200 }),
    });
    expect(mockPrisma.bridgeRound.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({ startWeightKg: 13_200 }),
    });
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.event).toBe("completed_tare_corrected");
    expect(audit.data.details.newTareWeightKg).toBe(13_200);
  });

  it("rejects a tare at or above round 1 end weight", async () => {
    await expect(
      correctCompletedTare(1, 30_000, "x", 0, 7),
    ).rejects.toThrow("tareMustBeLessThanFirstRoundEnd");
    expect(mockPrisma.truckOperation.updateMany).not.toHaveBeenCalled();
  });

  it("syncs the mirror session for scrap/billet-wire trucks", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "Completed",
      tareWeightKg: 13_500,
      skipInternalWeighing: true,
    });
    await correctCompletedTare(1, 13_200, "x", 0, 7);
    // mirror net = (30000 - 13200) / 1000 = 16.8
    expect(mockPrisma.weighSession.updateMany).toHaveBeenCalledWith({
      where: { bridgeRoundId: 11 },
      data: { weightTons: "16.800", version: { increment: 1 } },
    });
  });
});

// ─── Finance card number correction ────────────────────────────

describe("correctCompletedExternalCardNumber", () => {
  beforeEach(() => {
    mockPrisma.truckOperation.findUnique.mockImplementation(
      async (args: { where: { id?: number; externalCardNumber?: string } }) => {
        if (args.where.externalCardNumber != null) return null;
        return {
          id: 1,
          status: "Completed",
          externalCardNumber: "WB-1001",
        };
      },
    );
  });

  it("updates the card number and audits with reason", async () => {
    await correctCompletedExternalCardNumber(1, "WB-2002", "خطأ رقم كرت", 0, 7);

    expect(mockPrisma.truckOperation.updateMany).toHaveBeenCalledWith({
      where: { id: 1, version: 0 },
      data: {
        externalCardNumber: "WB-2002",
        version: { increment: 1 },
      },
    });
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.userId).toBe(7);
    expect(audit.data.action).toBe("update");
    expect(audit.data.entityType).toBe("TruckOperation");
    expect(audit.data.entityId).toBe("1");
    expect(audit.data.details.event).toBe("completed_external_card_corrected");
    expect(audit.data.details.oldExternalCardNumber).toBe("WB-1001");
    expect(audit.data.details.newExternalCardNumber).toBe("WB-2002");
    expect(audit.data.details.reason).toBe("خطأ رقم كرت");
    expect(audit.data.details.expectedVersion).toBe(0);
  });

  it("trims whitespace before storing the new card number", async () => {
    await correctCompletedExternalCardNumber(1, "  WB-2002  ", "تصحيح", 3, 7);

    expect(mockPrisma.truckOperation.updateMany).toHaveBeenCalledWith({
      where: { id: 1, version: 3 },
      data: {
        externalCardNumber: "WB-2002",
        version: { increment: 1 },
      },
    });
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.newExternalCardNumber).toBe("WB-2002");
  });

  it("rejects an empty card number", async () => {
    await expect(
      correctCompletedExternalCardNumber(1, "   ", "x", 0, 7),
    ).rejects.toThrow("weighbridgeCardRequired");
    await expect(
      correctCompletedExternalCardNumber(1, "", "x", 0, 7),
    ).rejects.toThrow("weighbridgeCardRequired");
    expect(mockPrisma.truckOperation.updateMany).not.toHaveBeenCalled();
  });

  it("rejects when the new number matches the current one (including after trim)", async () => {
    await expect(
      correctCompletedExternalCardNumber(1, "WB-1001", "x", 0, 7),
    ).rejects.toThrow("weighbridgeCardUnchanged");
    await expect(
      correctCompletedExternalCardNumber(1, "  WB-1001  ", "x", 0, 7),
    ).rejects.toThrow("weighbridgeCardUnchanged");
    expect(mockPrisma.truckOperation.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a card number already used by another truck", async () => {
    mockPrisma.truckOperation.findUnique.mockImplementation(
      async (args: { where: { id?: number; externalCardNumber?: string } }) => {
        if (args.where.externalCardNumber === "WB-9999") {
          return { id: 99 };
        }
        return {
          id: 1,
          status: "Completed",
          externalCardNumber: "WB-1001",
        };
      },
    );
    await expect(
      correctCompletedExternalCardNumber(1, "WB-9999", "x", 0, 7),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      correctCompletedExternalCardNumber(1, "WB-9999", "x", 0, 7),
    ).rejects.toThrow("weighbridgeCardAlreadyUsed");
    expect(mockPrisma.truckOperation.updateMany).not.toHaveBeenCalled();
  });

  it("allows the lookup hit when the duplicate row is the same truck", async () => {
    // Race-friendly path: unique lookup returns this truck itself.
    mockPrisma.truckOperation.findUnique.mockImplementation(
      async (args: { where: { id?: number; externalCardNumber?: string } }) => {
        if (args.where.externalCardNumber === "WB-2002") {
          return { id: 1 };
        }
        return {
          id: 1,
          status: "Completed",
          externalCardNumber: "WB-1001",
        };
      },
    );
    await correctCompletedExternalCardNumber(1, "WB-2002", "تصحيح", 0, 7);
    expect(mockPrisma.truckOperation.updateMany).toHaveBeenCalled();
  });

  it("raises a conflict when the truck version moved", async () => {
    mockPrisma.truckOperation.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      correctCompletedExternalCardNumber(1, "WB-2002", "x", 0, 7),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects when the truck is not Completed", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "OnScale",
      externalCardNumber: "WB-1001",
    });
    await expect(
      correctCompletedExternalCardNumber(1, "WB-2002", "x", 0, 7),
    ).rejects.toThrow("adminCorrectionOnlyForCompletedTrucks");
    expect(mockPrisma.truckOperation.updateMany).not.toHaveBeenCalled();
  });

  it("rejects when the truck does not exist", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    await expect(
      correctCompletedExternalCardNumber(1, "WB-2002", "x", 0, 7),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockPrisma.truckOperation.updateMany).not.toHaveBeenCalled();
  });
});

// ─── External weighing correction ──────────────────────────────

describe("correctCompletedRoundExternal", () => {
  beforeEach(() => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "Completed",
      skipInternalWeighing: false,
    });
  });

  it("corrects a non-final round and cascades to the next round start", async () => {
    mockPrisma.bridgeRound.findUnique.mockResolvedValue({
      id: 11,
      truckOperationId: 1,
      roundNumber: 1,
      startWeightKg: 13_200,
      endWeightKg: 30_000,
      isFinal: false,
    });
    mockPrisma.bridgeRound.updateMany.mockResolvedValue({ count: 1 });

    await correctCompletedRoundExternal(1, 11, 30_400, "تصحيح دورة 1", 0, 7);

    // operation version bumped, gross untouched (not final)
    const opUpdate = mockPrisma.truckOperation.updateMany.mock.calls[0][0];
    expect(opUpdate.data).not.toHaveProperty("grossWeightKg");
    expect(mockPrisma.bridgeRound.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({ endWeightKg: 30_400 }),
    });
    expect(mockPrisma.bridgeRound.updateMany).toHaveBeenCalledWith({
      where: { truckOperationId: 1, roundNumber: 2 },
      data: { startWeightKg: 30_400 },
    });
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.event).toBe("completed_external_corrected");
    expect(audit.data.details.cascadedToNextRound).toBe(true);
  });

  it("updates grossWeightKg when correcting the final round", async () => {
    mockPrisma.bridgeRound.findUnique.mockResolvedValue({
      id: 12,
      truckOperationId: 1,
      roundNumber: 2,
      startWeightKg: 30_000,
      endWeightKg: 45_000,
      isFinal: true,
    });
    await correctCompletedRoundExternal(1, 12, 45_500, "تصحيح نهائي", 0, 7);
    const opUpdate = mockPrisma.truckOperation.updateMany.mock.calls[0][0];
    expect(opUpdate.data.grossWeightKg).toBe(45_500);
  });

  it("rejects a weight at or below the round start", async () => {
    mockPrisma.bridgeRound.findUnique.mockResolvedValue({
      id: 11,
      truckOperationId: 1,
      roundNumber: 1,
      startWeightKg: 13_200,
      endWeightKg: 30_000,
      isFinal: false,
    });
    await expect(
      correctCompletedRoundExternal(1, 11, 13_000, "x", 0, 7),
    ).rejects.toThrow("grossMustExceedRoundStart");
  });
});

// ─── Internal session add / edit / delete ──────────────────────

describe("completed session add/edit/delete", () => {
  it("adds a session without changing truck status", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "Completed",
      skipInternalWeighing: false,
    });
    mockPrisma.bridgeRound.findUnique.mockResolvedValue({
      id: 11,
      truckOperationId: 1,
      roundNumber: 1,
    });
    mockPrisma.sizeLookup.findUnique.mockResolvedValue({ id: 3, isActive: true });
    mockPrisma.weighSession.findFirst.mockResolvedValue({ sessionNumber: 2 });
    mockPrisma.weighSession.create.mockResolvedValue({ id: 99, sessionNumber: 3 });

    await addCompletedSession(1, 11, { sizeId: 3, weightTons: 5 }, "وزنة ناقصة", 7);

    expect(mockPrisma.weighSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bridgeRoundId: 11, sessionNumber: 3 }),
      }),
    );
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.event).toBe("completed_session_added");
    // no status mutation path exists
    expect(mockPrisma.truckOperation.updateMany).not.toHaveBeenCalled();
  });

  it("refuses session add on scrap/billet-wire trucks", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "Completed",
      skipInternalWeighing: true,
    });
    await expect(
      addCompletedSession(1, 11, { weightTons: 5 }, "x", 7),
    ).rejects.toThrow("scrapTruckNoInternalWeighs");
    expect(mockPrisma.weighSession.create).not.toHaveBeenCalled();
  });

  it("edits a session with optimistic lock", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "Completed",
      skipInternalWeighing: false,
    });
    mockPrisma.weighSession.findUnique.mockResolvedValue({
      id: 50,
      truckOperationId: 1,
      version: 0,
    });
    mockPrisma.weighSession.updateMany.mockResolvedValue({ count: 1 });

    await editCompletedSession(1, 50, { weightTons: 5.2 }, "خطأ رقم", 0, 7);

    expect(mockPrisma.weighSession.updateMany).toHaveBeenCalledWith({
      where: { id: 50, version: 0 },
      data: expect.objectContaining({ weightTons: 5.2, version: { increment: 1 } }),
    });
  });

  it("deletes a session without resetting truck status", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "Completed",
      skipInternalWeighing: false,
    });
    mockPrisma.weighSession.findUnique.mockResolvedValue({
      id: 50,
      truckOperationId: 1,
      bridgeRoundId: 11,
      sessionNumber: 4,
      sizeId: 3,
      bundleCount: 2,
      weightTons: 3,
      version: 0,
    });
    mockPrisma.weighSession.deleteMany.mockResolvedValue({ count: 1 });

    await deleteCompletedSession(1, 50, "مكررة", 0, 7);

    expect(mockPrisma.weighSession.deleteMany).toHaveBeenCalledWith({
      where: { id: 50, version: 0 },
    });
    const audit = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(audit.data.details.event).toBe("completed_session_deleted");
    // delete must NOT touch the operation row (no status change)
    expect(mockPrisma.truckOperation.updateMany).not.toHaveBeenCalled();
  });

  it("rejects edit/delete when truck is not Completed", async () => {
    mockPrisma.truckOperation.findUnique.mockResolvedValue({
      id: 1,
      status: "OnScale",
      skipInternalWeighing: false,
    });
    await expect(
      editCompletedSession(1, 50, { weightTons: 5 }, "x", 0, 7),
    ).rejects.toThrow("adminCorrectionOnlyForCompletedTrucks");
  });
});
