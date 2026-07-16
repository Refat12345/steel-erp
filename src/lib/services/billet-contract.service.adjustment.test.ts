/**
 * Contract adjustment ("تسوية") and weight-only prior withdrawal tests.
 *
 * Covers:
 * - Validator rules: signed weight/pieces, at-least-one-effect, no
 *   duplicate lengths, optional piece lines on prior withdrawals.
 * - Balance aggregation: adjustment rows contribute SIGNED piece deltas
 *   (never clamped to zero) while normal receipts stay clamped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  supplierContract: {
    findUnique: vi.fn(),
  },
  billetReceipt: {
    findMany: vi.fn(),
  },
  supplierContractAttachment: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./tx-retry", () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
}));

import {
  priorWithdrawalSchema,
  contractAdjustmentSchema,
} from "@/lib/validators/billet-contract";
import { getContractWithBalance } from "./billet-contract.service";

describe("contractAdjustmentSchema", () => {
  it("accepts a negative weight-only adjustment", () => {
    const parsed = contractAdjustmentSchema.safeParse({
      netWeightKg: -1500,
      notes: "تصحيح وزن",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.netWeightKg).toBe(-1500);
      expect(parsed.data.pieceLines).toEqual([]);
    }
  });

  it("accepts a pieces-only adjustment with signed deltas", () => {
    const parsed = contractAdjustmentSchema.safeParse({
      notes: "تصحيح عدد",
      pieceLines: [
        { billetLengthM: 6, pieces: -10 },
        { billetLengthM: 12, pieces: 4 },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.netWeightKg).toBe(0);
  });

  it("rejects an adjustment with no weight and no pieces", () => {
    const parsed = contractAdjustmentSchema.safeParse({
      netWeightKg: 0,
      notes: "بدون تأثير",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a zero piece delta", () => {
    const parsed = contractAdjustmentSchema.safeParse({
      notes: "صفر",
      pieceLines: [{ billetLengthM: 6, pieces: 0 }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate lengths", () => {
    const parsed = contractAdjustmentSchema.safeParse({
      notes: "تكرار",
      pieceLines: [
        { billetLengthM: 6, pieces: 1 },
        { billetLengthM: 6, pieces: 2 },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a missing reason", () => {
    const parsed = contractAdjustmentSchema.safeParse({
      netWeightKg: 100,
      notes: "  ",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("priorWithdrawalSchema", () => {
  it("accepts a weight-only prior withdrawal (no piece lines)", () => {
    const parsed = priorWithdrawalSchema.safeParse({
      netWeightKg: 8_330_940,
      notes: "سحب سابق قبل تشغيل النظام",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.pieceLines).toEqual([]);
  });

  it("still rejects a non-positive weight", () => {
    const parsed = priorWithdrawalSchema.safeParse({
      netWeightKg: -5,
      notes: "سحب",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("getContractWithBalance — signed adjustment aggregation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.supplierContract.findUnique.mockResolvedValue({
      contractNumber: "P-26-001",
      supplierName: "Medsteel",
      status: "Active",
      contractedWeightKg: "25000000",
      pieceLines: [{ billetLengthM: 6, contractedPieces: 1000 }],
      creator: { username: "admin", fullName: "Admin" },
    });
    mockPrisma.supplierContractAttachment.findMany.mockResolvedValue([]);
  });

  it("adds signed adjustment deltas and clamps only normal receipts", async () => {
    mockPrisma.billetReceipt.findMany
      // getCompletedUsage call
      .mockResolvedValueOnce([
        {
          netWeightKg: "100000",
          isAdjustment: false,
          pieceLines: [
            // Normal receipt: rejected > counted clamps to 0, not -5.
            { billetLengthM: 6, countedPieces: 10, rejectedPieces: 15 },
          ],
        },
        {
          netWeightKg: "-2000",
          isAdjustment: true,
          pieceLines: [
            // Adjustment: signed delta must survive as -30.
            { billetLengthM: 6, countedPieces: -30, rejectedPieces: 0 },
          ],
        },
        {
          netWeightKg: "500",
          isAdjustment: true,
          pieceLines: [
            { billetLengthM: 6, countedPieces: 12, rejectedPieces: 0 },
          ],
        },
      ])
      // recent receipts list call
      .mockResolvedValueOnce([]);

    const result = await getContractWithBalance("P-26-001");

    // 100000 - 2000 + 500
    expect(Number(result.receivedWeightKg)).toBe(98500);
    expect(Number(result.remainingWeightKg)).toBe(25000000 - 98500);

    // 0 (clamped) - 30 + 12
    expect(result.pieceBalances).toEqual([
      {
        billetLengthM: 6,
        contractedPieces: 1000,
        acceptedPieces: -18,
        remainingPieces: 1018,
      },
    ]);

    // Adjustments feed the balance but are hidden from the receipts list.
    expect(mockPrisma.billetReceipt.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { supplierContractNumber: "P-26-001", isAdjustment: false },
      }),
    );
    expect(result.receipts).toEqual([]);
  });
});
