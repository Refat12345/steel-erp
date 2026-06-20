import { prisma } from "@/lib/db";
import { Prisma, type BilletReceiptStatus } from "@prisma/client";
import Decimal from "decimal.js";
import type { PaginationParams, PaginatedResult } from "@/lib/api-utils";
import type {
  RegisterReceiptInput,
  UpdateReceiptRegistrationInput,
  UnloadResultInput,
} from "@/lib/validators/billet-receipt";
import { ServiceError } from "./errors";
import { logAudit } from "./audit.service";
import { withRetry } from "./tx-retry";
import { logger } from "@/lib/logger";
import {
  validateWeightRange,
  validateGrossWeight,
  validateTareWeight,
} from "@/lib/weight-bounds";

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const TERMINAL_STATUSES: BilletReceiptStatus[] = ["Completed", "Cancelled"];

const VALID_TRANSITIONS: Record<BilletReceiptStatus, BilletReceiptStatus[]> = {
  Registered: ["Loaded", "Cancelled"],
  Loaded: ["Unloading", "Cancelled"],
  Unloading: ["AwaitingExit", "Cancelled"],
  AwaitingExit: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

function assertTransition(current: BilletReceiptStatus, next: BilletReceiptStatus) {
  if (!VALID_TRANSITIONS[current]?.includes(next)) {
    throw new ServiceError(
      `لا يمكن الانتقال من الحالة "${current}" إلى "${next}"`,
    );
  }
}

function declaredDiffThresholdKg(): number {
  const raw = process.env.BILLET_DECLARED_DIFF_THRESHOLD_KG;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
}

async function lockReceipt(tx: TxClient, receiptId: number) {
  const locked = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM billet_receipts WHERE id = ${receiptId} FOR UPDATE
  `;
  if (locked.length === 0) {
    throw new ServiceError("سجل الاستلام غير موجود", "NOT_FOUND");
  }
}

async function getCompletedContractUsage(
  tx: TxClient,
  contractNumber: string,
  excludeReceiptId?: number,
) {
  const completedReceipts = await tx.billetReceipt.findMany({
    where: {
      supplierContractNumber: contractNumber,
      status: "Completed",
      ...(excludeReceiptId !== undefined && { id: { not: excludeReceiptId } }),
    },
    select: { netWeightKg: true, pieceLines: true },
  });

  let receivedWeight = new Decimal(0);
  const acceptedByLength = new Map<number, number>();
  for (const receipt of completedReceipts) {
    if (receipt.netWeightKg != null) {
      receivedWeight = receivedWeight.plus(receipt.netWeightKg);
    }
    for (const line of receipt.pieceLines) {
      const accepted = Math.max(0, (line.countedPieces ?? 0) - line.rejectedPieces);
      acceptedByLength.set(
        line.billetLengthM,
        (acceptedByLength.get(line.billetLengthM) ?? 0) + accepted,
      );
    }
  }

  return { receivedWeight, acceptedByLength };
}

// ─── Register (Logistics) ──────────────────────────────────────────

async function generateReceiptNumber(tx: TxClient): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `R-${yy}-`;
  const existing = await tx.billetReceipt.findMany({
    where: { receiptNumber: { startsWith: prefix } },
    select: { receiptNumber: true },
  });
  let maxSeq = 0;
  for (const r of existing) {
    const seq = parseInt(r.receiptNumber.slice(prefix.length), 10);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
}

export async function registerReceipt(data: RegisterReceiptInput, userId: number) {
  const normalizedPlate = data.plateNumber.trim();
  const lengths = data.pieceLines.map((l) => l.billetLengthM);
  if (new Set(lengths).size !== lengths.length) {
    throw new ServiceError("لا يمكن تكرار نفس الطول في الطلبية");
  }

  let receipt;
  try {
    receipt = await withRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const contract = await tx.supplierContract.findUnique({
            where: { contractNumber: data.supplierContractNumber },
            include: { pieceLines: true },
          });
          if (!contract) throw new ServiceError("عقد المورّد غير موجود", "NOT_FOUND");
          if (contract.status !== "Active") {
            throw new ServiceError("لا يمكن التسجيل على عقد غير فعّال");
          }

          // Every declared length must exist in the contract's piece lines.
          const contractLengths = new Set(contract.pieceLines.map((l) => l.billetLengthM));
          for (const l of data.pieceLines) {
            if (!contractLengths.has(l.billetLengthM)) {
              throw new ServiceError(
                `الطول ${l.billetLengthM}م غير موجود في عقد المورّد`,
              );
            }
          }

          const { receivedWeight, acceptedByLength } =
            await getCompletedContractUsage(tx, contract.contractNumber);
          const declaredWeight = new Decimal(data.declaredWeightKg);
          const remainingWeight = new Decimal(contract.contractedWeightKg).minus(
            receivedWeight,
          );
          if (declaredWeight.greaterThan(remainingWeight)) {
            throw new ServiceError(
              `وزن الطلبية المعلن (${declaredWeight.toFixed(3)} كغ) يتجاوز رصيد العقد المتبقي (${remainingWeight.toFixed(3)} كغ)`,
            );
          }

          for (const line of data.pieceLines) {
            const contractLine = contract.pieceLines.find(
              (l) => l.billetLengthM === line.billetLengthM,
            );
            const accepted = acceptedByLength.get(line.billetLengthM) ?? 0;
            const remainingPieces = (contractLine?.contractedPieces ?? 0) - accepted;
            if (line.expectedPieces > remainingPieces) {
              throw new ServiceError(
                `عدد القطع المعلن للطول ${line.billetLengthM}م (${line.expectedPieces}) يتجاوز رصيد العقد المتبقي (${remainingPieces})`,
              );
            }
          }

          const existingOpen = await tx.billetReceipt.findFirst({
            where: {
              plateNumber: normalizedPlate,
              status: { notIn: TERMINAL_STATUSES },
            },
            select: { id: true },
          });
          if (existingOpen) {
            throw new ServiceError(
              `يوجد سجل استلام مفتوح لنفس رقم اللوحة (سجل #${existingOpen.id})`,
              "CONFLICT",
            );
          }

          const receiptNumber = await generateReceiptNumber(tx);

          const created = await tx.billetReceipt.create({
            data: {
              receiptNumber,
              supplierContractNumber: data.supplierContractNumber,
              driverName: data.driverName.trim(),
              plateNumber: normalizedPlate,
              driverNationalId: data.driverNationalId?.trim() || null,
              declaredWeightKg: new Decimal(data.declaredWeightKg).toFixed(3),
              bundleCount: data.bundleCount ?? null,
              notes: data.notes?.trim() || null,
              status: "Registered",
              createdById: userId,
              pieceLines: {
                create: data.pieceLines.map((l) => ({
                  billetLengthM: l.billetLengthM,
                  expectedPieces: l.expectedPieces,
                })),
              },
            },
            include: { pieceLines: { orderBy: { billetLengthM: "asc" } } },
          });

          await logAudit(tx, {
            userId,
            action: "create",
            entityType: "BilletReceipt",
            entityId: String(created.id),
            details: {
              event: "receipt_registered",
              receiptNumber,
              supplierContractNumber: data.supplierContractNumber,
              plateNumber: created.plateNumber,
              driverName: created.driverName,
              declaredWeightKg: Number(created.declaredWeightKg),
              pieceLines: data.pieceLines,
            },
          });

          return created;
        },
        { isolationLevel: "Serializable" },
      ),
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = e.meta?.target;
      const targetStr = Array.isArray(target) ? target.join(",") : String(target ?? "");
      if (targetStr.includes("plate_number")) {
        throw new ServiceError(
          `يوجد سجل استلام مفتوح لنفس رقم اللوحة (${normalizedPlate})`,
          "CONFLICT",
        );
      }
    }
    throw e;
  }

  logger.info(
    { receiptId: receipt.id, receiptNumber: receipt.receiptNumber },
    "billet receipt registered",
  );
  return receipt;
}

export async function updateReceiptRegistration(
  receiptId: number,
  data: UpdateReceiptRegistrationInput,
  userId: number,
) {
  const normalizedPlate = data.plateNumber.trim();
  const lengths = data.pieceLines.map((l) => l.billetLengthM);
  if (new Set(lengths).size !== lengths.length) {
    throw new ServiceError("لا يمكن تكرار نفس الطول في الطلبية");
  }

  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await lockReceipt(tx, receiptId);
        const receipt = await tx.billetReceipt.findUnique({
          where: { id: receiptId },
          include: { pieceLines: true },
        });
        if (!receipt) throw new ServiceError("سجل الاستلام غير موجود", "NOT_FOUND");

        if (!["Registered", "Loaded"].includes(receipt.status)) {
          throw new ServiceError("لا يمكن تعديل الشاحنة بعد بدء التفريغ الداخلي");
        }
        if (receipt.unloadingPhotoPath != null || receipt.unloadingPhotoAt != null) {
          throw new ServiceError("لا يمكن تعديل الشاحنة بعد التقاط صورة التفريغ");
        }

        const contract = await tx.supplierContract.findUnique({
          where: { contractNumber: data.supplierContractNumber },
          include: { pieceLines: true },
        });
        if (!contract) throw new ServiceError("عقد المورّد غير موجود", "NOT_FOUND");
        if (contract.status !== "Active") {
          throw new ServiceError("لا يمكن ربط الاستلام بعقد غير فعّال");
        }

        const contractLengths = new Set(contract.pieceLines.map((l) => l.billetLengthM));
        for (const line of data.pieceLines) {
          if (!contractLengths.has(line.billetLengthM)) {
            throw new ServiceError(
              `الطول ${line.billetLengthM}م غير موجود في عقد المورّد`,
            );
          }
        }

        const { receivedWeight, acceptedByLength } = await getCompletedContractUsage(
          tx,
          contract.contractNumber,
        );
        const declaredWeight = new Decimal(data.declaredWeightKg);
        const remainingWeight = new Decimal(contract.contractedWeightKg).minus(
          receivedWeight,
        );
        if (declaredWeight.greaterThan(remainingWeight)) {
          throw new ServiceError(
            `وزن الطلبية المعلن (${declaredWeight.toFixed(3)} كغ) يتجاوز رصيد العقد المتبقي (${remainingWeight.toFixed(3)} كغ)`,
          );
        }

        for (const line of data.pieceLines) {
          const contractLine = contract.pieceLines.find(
            (l) => l.billetLengthM === line.billetLengthM,
          );
          const accepted = acceptedByLength.get(line.billetLengthM) ?? 0;
          const remainingPieces = (contractLine?.contractedPieces ?? 0) - accepted;
          if (line.expectedPieces > remainingPieces) {
            throw new ServiceError(
              `عدد القطع المعلن للطول ${line.billetLengthM}م (${line.expectedPieces}) يتجاوز رصيد العقد المتبقي (${remainingPieces})`,
            );
          }
        }

        const existingOpen = await tx.billetReceipt.findFirst({
          where: {
            id: { not: receiptId },
            plateNumber: normalizedPlate,
            status: { notIn: TERMINAL_STATUSES },
          },
          select: { id: true },
        });
        if (existingOpen) {
          throw new ServiceError(
            `يوجد سجل استلام مفتوح لنفس رقم اللوحة (سجل #${existingOpen.id})`,
            "CONFLICT",
          );
        }

        await tx.billetReceiptPieceLine.deleteMany({
          where: { billetReceiptId: receiptId },
        });

        const updated = await tx.billetReceipt.update({
          where: { id: receiptId },
          data: {
            supplierContractNumber: data.supplierContractNumber,
            driverName: data.driverName.trim(),
            plateNumber: normalizedPlate,
            driverNationalId: data.driverNationalId?.trim() || null,
            declaredWeightKg: new Decimal(data.declaredWeightKg).toFixed(3),
            bundleCount: data.bundleCount ?? null,
            notes: data.notes?.trim() || null,
            version: { increment: 1 },
            pieceLines: {
              create: data.pieceLines.map((line) => ({
                billetLengthM: line.billetLengthM,
                expectedPieces: line.expectedPieces,
              })),
            },
          },
          include: { pieceLines: { orderBy: { billetLengthM: "asc" } } },
        });

        await logAudit(tx, {
          userId,
          action: "update",
          entityType: "BilletReceipt",
          entityId: String(receiptId),
          details: {
            event: "receipt_registration_updated",
            previousValue: {
              supplierContractNumber: receipt.supplierContractNumber,
              driverName: receipt.driverName,
              plateNumber: receipt.plateNumber,
              driverNationalId: receipt.driverNationalId,
              declaredWeightKg: Number(receipt.declaredWeightKg),
              bundleCount: receipt.bundleCount,
              notes: receipt.notes,
              pieceLines: receipt.pieceLines.map((line) => ({
                billetLengthM: line.billetLengthM,
                expectedPieces: line.expectedPieces,
              })),
            },
            newValue: {
              supplierContractNumber: data.supplierContractNumber,
              driverName: data.driverName.trim(),
              plateNumber: normalizedPlate,
              driverNationalId: data.driverNationalId?.trim() || null,
              declaredWeightKg: data.declaredWeightKg,
              bundleCount: data.bundleCount ?? null,
              notes: data.notes?.trim() || null,
              pieceLines: data.pieceLines,
            },
          },
        });

        logger.info({ receiptId }, "billet receipt registration updated");
        return updated;
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

// ─── Loaded Weight (External Scale) ────────────────────────────────

export async function enterLoadedWeight(
  receiptId: number,
  weightKg: number,
  userId: number,
) {
  const rangeError = validateWeightRange(weightKg);
  if (rangeError) throw new ServiceError(rangeError);
  const grossError = validateGrossWeight(weightKg);
  if (grossError) throw new ServiceError(grossError);

  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await lockReceipt(tx, receiptId);
        const receipt = await tx.billetReceipt.findUnique({ where: { id: receiptId } });
        if (!receipt) throw new ServiceError("سجل الاستلام غير موجود", "NOT_FOUND");

        if (receipt.loadedWeightKg != null) {
          throw new ServiceError(
            `تم إدخال وزن المحمّل مسبقاً (${Number(receipt.loadedWeightKg)} كغ)`,
            "CONFLICT",
          );
        }
        assertTransition(receipt.status, "Loaded");

        const now = new Date();
        const updated = await tx.billetReceipt.update({
          where: { id: receiptId },
          data: {
            loadedWeightKg: weightKg,
            entryTime: now,
            status: "Loaded",
            version: { increment: 1 },
          },
        });

        await logAudit(tx, {
          userId,
          action: "status_change",
          entityType: "BilletReceipt",
          entityId: String(receiptId),
          details: {
            event: "loaded_weight_recorded",
            previousValue: { status: receipt.status, loadedWeightKg: null },
            newValue: { status: "Loaded", loadedWeightKg: weightKg },
          },
        });

        logger.info({ receiptId, weightKg }, "billet loaded weight recorded");
        return updated;
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

// ─── Start Unloading (Internal Loader photo — starts timer) ────────

export async function startUnloading(
  receiptId: number,
  photoPath: string,
  userId: number,
) {
  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await lockReceipt(tx, receiptId);
        const receipt = await tx.billetReceipt.findUnique({ where: { id: receiptId } });
        if (!receipt) throw new ServiceError("سجل الاستلام غير موجود", "NOT_FOUND");

        assertTransition(receipt.status, "Unloading");

        const now = new Date();
        const updated = await tx.billetReceipt.update({
          where: { id: receiptId },
          data: {
            unloadingPhotoPath: photoPath,
            unloadingPhotoAt: now,
            status: "Unloading",
            version: { increment: 1 },
          },
        });

        await logAudit(tx, {
          userId,
          action: "status_change",
          entityType: "BilletReceipt",
          entityId: String(receiptId),
          details: {
            event: "unloading_started",
            previousValue: { status: receipt.status },
            newValue: { status: "Unloading", unloadingPhotoAt: now.toISOString() },
          },
        });

        logger.info({ receiptId }, "billet unloading started (photo)");
        return updated;
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

// ─── Enter Unload Result (counted + rejected pieces — ends timer) ──

export async function enterUnloadResult(
  receiptId: number,
  data: UnloadResultInput,
  userId: number,
) {
  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await lockReceipt(tx, receiptId);
        const receipt = await tx.billetReceipt.findUnique({
          where: { id: receiptId },
          include: { pieceLines: true },
        });
        if (!receipt) throw new ServiceError("سجل الاستلام غير موجود", "NOT_FOUND");

        assertTransition(receipt.status, "AwaitingExit");

        const registeredLengths = new Set(receipt.pieceLines.map((l) => l.billetLengthM));
        const providedLengths = new Set(data.lines.map((l) => l.billetLengthM));
        if (
          registeredLengths.size !== providedLengths.size ||
          [...registeredLengths].some((l) => !providedLengths.has(l))
        ) {
          throw new ServiceError("يجب إدخال العدّ لكل طول مسجّل في الطلبية");
        }

        let hasMismatch = false;
        for (const line of data.lines) {
          const registered = receipt.pieceLines.find(
            (p) => p.billetLengthM === line.billetLengthM,
          );
          if (!registered) {
            throw new ServiceError(`الطول ${line.billetLengthM}م غير مسجّل`);
          }
          if (line.rejectedPieces > line.countedPieces) {
            throw new ServiceError("المرتجع لا يمكن أن يتجاوز المعدود");
          }
          if (line.countedPieces !== registered.expectedPieces) hasMismatch = true;
        }

        const reason = data.mismatchReason?.trim() || null;
        if (hasMismatch && !reason) {
          throw new ServiceError(
            "يوجد فرق بين العدد المعدود والمعلن — سبب الفرق إجباري للإكمال",
            "BAD_REQUEST",
          );
        }

        const contract = await tx.supplierContract.findUnique({
          where: { contractNumber: receipt.supplierContractNumber },
          include: { pieceLines: true },
        });
        if (!contract) throw new ServiceError("عقد المورّد غير موجود", "NOT_FOUND");

        const { acceptedByLength } = await getCompletedContractUsage(
          tx,
          receipt.supplierContractNumber,
          receiptId,
        );
        let totalAcceptedPieces = 0;
        for (const line of data.lines) {
          const accepted = line.countedPieces - line.rejectedPieces;
          totalAcceptedPieces += accepted;
          const contractLine = contract.pieceLines.find(
            (c) => c.billetLengthM === line.billetLengthM,
          );
          if (!contractLine) {
            throw new ServiceError(`الطول ${line.billetLengthM}م غير موجود في عقد المورّد`);
          }

          const priorAccepted = acceptedByLength.get(line.billetLengthM) ?? 0;
          const remainingPieces = contractLine.contractedPieces - priorAccepted;
          if (accepted > remainingPieces) {
            throw new ServiceError(
              `القطع المقبولة للطول ${line.billetLengthM}م (${accepted}) تتجاوز رصيد العقد المتبقي (${remainingPieces})`,
            );
          }
        }
        if (totalAcceptedPieces <= 0) {
          throw new ServiceError(
            "لا يمكن تثبيت العدّ لأن عدد القطع المقبولة صفر. إذا كل القطع مرفوضة، ألغِ الاستلام مع ذكر السبب.",
          );
        }

        for (const line of data.lines) {
          await tx.billetReceiptPieceLine.updateMany({
            where: { billetReceiptId: receiptId, billetLengthM: line.billetLengthM },
            data: {
              countedPieces: line.countedPieces,
              rejectedPieces: line.rejectedPieces,
            },
          });
        }

        const now = new Date();
        const updated = await tx.billetReceipt.update({
          where: { id: receiptId },
          data: {
            countEnteredAt: now,
            countMismatchReason: reason,
            status: "AwaitingExit",
            version: { increment: 1 },
          },
          include: { pieceLines: { orderBy: { billetLengthM: "asc" } } },
        });

        await logAudit(tx, {
          userId,
          action: "status_change",
          entityType: "BilletReceipt",
          entityId: String(receiptId),
          details: {
            event: "unload_result_entered",
            hasMismatch,
            mismatchReason: reason,
            lines: data.lines,
            unloadingDurationMs:
              receipt.unloadingPhotoAt != null
                ? now.getTime() - receipt.unloadingPhotoAt.getTime()
                : null,
            newValue: { status: "AwaitingExit" },
          },
        });

        if (hasMismatch) {
          logger.warn(
            { receiptId, reason },
            "billet unload count mismatch — continued with reason",
          );
        }
        logger.info({ receiptId }, "billet unload result entered");
        return updated;
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

export async function reopenUnloadResult(receiptId: number, userId: number) {
  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await lockReceipt(tx, receiptId);
        const receipt = await tx.billetReceipt.findUnique({ where: { id: receiptId } });
        if (!receipt) throw new ServiceError("سجل الاستلام غير موجود", "NOT_FOUND");

        if (receipt.status !== "AwaitingExit") {
          throw new ServiceError("يمكن الرجوع لتعديل العد فقط قبل إدخال وزن الفارغ");
        }
        if (receipt.emptyWeightKg != null) {
          throw new ServiceError("لا يمكن الرجوع بعد إدخال وزن الفارغ");
        }

        const updated = await tx.billetReceipt.update({
          where: { id: receiptId },
          data: {
            status: "Unloading",
            countEnteredAt: null,
            countMismatchReason: null,
            version: { increment: 1 },
          },
          include: { pieceLines: { orderBy: { billetLengthM: "asc" } } },
        });

        await logAudit(tx, {
          userId,
          action: "status_change",
          entityType: "BilletReceipt",
          entityId: String(receiptId),
          details: {
            event: "unload_result_reopened",
            from: receipt.status,
            to: "Unloading",
          },
        });

        logger.info({ receiptId }, "billet unload result reopened");
        return updated;
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

// ─── Complete (External Scale empty weight + contract deduction) ───

export async function completeReceipt(
  receiptId: number,
  emptyWeightKg: number,
  userId: number,
) {
  const tareError = validateTareWeight(emptyWeightKg);
  if (tareError) throw new ServiceError(tareError);

  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await lockReceipt(tx, receiptId);
        const receipt = await tx.billetReceipt.findUnique({
          where: { id: receiptId },
          include: { pieceLines: true },
        });
        if (!receipt) throw new ServiceError("سجل الاستلام غير موجود", "NOT_FOUND");

        assertTransition(receipt.status, "Completed");

        if (receipt.loadedWeightKg == null) {
          throw new ServiceError("يجب إدخال وزن المحمّل أولاً");
        }
        const loadedKg = Number(receipt.loadedWeightKg);
        if (emptyWeightKg >= loadedKg) {
          throw new ServiceError(
            `وزن الفارغ (${emptyWeightKg} كغ) يجب أن يكون أقل من وزن المحمّل (${loadedKg} كغ)`,
          );
        }
        const grossError = validateGrossWeight(loadedKg, emptyWeightKg);
        if (grossError) throw new ServiceError(grossError);

        // Lock the contract row so concurrent completions deduct serially.
        await tx.$queryRaw`
          SELECT contract_number FROM supplier_contracts
          WHERE contract_number = ${receipt.supplierContractNumber} FOR UPDATE
        `;
        const contract = await tx.supplierContract.findUnique({
          where: { contractNumber: receipt.supplierContractNumber },
          include: { pieceLines: true },
        });
        if (!contract) throw new ServiceError("عقد المورّد غير موجود", "NOT_FOUND");

        const netKg = new Decimal(loadedKg).minus(emptyWeightKg);
        const now = new Date();

        // Contract balance guard. This is blocking and runs while the contract
        // row is locked, so concurrent completions cannot overshoot silently.
        const { receivedWeight: priorWeight, acceptedByLength } =
          await getCompletedContractUsage(
            tx,
            receipt.supplierContractNumber,
            receiptId,
          );

        const totalWeightAfter = priorWeight.plus(netKg);
        const weightOvershoot = totalWeightAfter.greaterThan(contract.contractedWeightKg);

        const pieceOvershoots: { billetLengthM: number; over: number }[] = [];
        let totalAcceptedPieces = 0;
        for (const line of receipt.pieceLines) {
          const accepted = Math.max(0, (line.countedPieces ?? 0) - line.rejectedPieces);
          totalAcceptedPieces += accepted;
          const priorAccepted = acceptedByLength.get(line.billetLengthM) ?? 0;
          const contractLine = contract.pieceLines.find(
            (c) => c.billetLengthM === line.billetLengthM,
          );
          if (contractLine) {
            const after = priorAccepted + accepted;
            if (after > contractLine.contractedPieces) {
              pieceOvershoots.push({
                billetLengthM: line.billetLengthM,
                over: after - contractLine.contractedPieces,
              });
            }
          } else {
            throw new ServiceError(`الطول ${line.billetLengthM}م غير موجود في عقد المورّد`);
          }
        }

        if (totalAcceptedPieces <= 0) {
          throw new ServiceError(
            "لا يمكن إغلاق الاستلام لأن عدد القطع المقبولة صفر. إذا كل القطع مرفوضة، ألغِ الاستلام مع ذكر السبب.",
          );
        }

        if (weightOvershoot) {
          const remainingWeight = new Decimal(contract.contractedWeightKg).minus(
            priorWeight,
          );
          throw new ServiceError(
            `لا يمكن إغلاق الاستلام: الصافي (${netKg.toFixed(1)} كغ) يتجاوز رصيد وزن العقد المتبقي (${remainingWeight.toFixed(3)} كغ)`,
          );
        }

        if (pieceOvershoots.length > 0) {
          const first = pieceOvershoots[0];
          const contractLine = contract.pieceLines.find(
            (line) => line.billetLengthM === first.billetLengthM,
          );
          const priorAccepted = acceptedByLength.get(first.billetLengthM) ?? 0;
          const remainingPieces = (contractLine?.contractedPieces ?? 0) - priorAccepted;
          throw new ServiceError(
            `لا يمكن إغلاق الاستلام: القطع المقبولة للطول ${first.billetLengthM}م تتجاوز رصيد العقد المتبقي (${remainingPieces}) بمقدار ${first.over} قطعة`,
          );
        }

        // ── Declared-weight diff warning (non-blocking) ───────────────
        const declaredDiffKg = netKg.minus(receipt.declaredWeightKg).abs();
        const declaredDiffExceeded = declaredDiffKg.greaterThan(declaredDiffThresholdKg());

        const updated = await tx.billetReceipt.update({
          where: { id: receiptId },
          data: {
            emptyWeightKg,
            exitTime: now,
            netWeightKg: netKg.toFixed(1),
            status: "Completed",
            closedById: userId,
            closedAt: now,
            version: { increment: 1 },
          },
          include: { pieceLines: { orderBy: { billetLengthM: "asc" } } },
        });

        await logAudit(tx, {
          userId,
          action: "status_change",
          entityType: "BilletReceipt",
          entityId: String(receiptId),
          details: {
            event: "receipt_completed",
            from: receipt.status,
            to: "Completed",
            loadedWeightKg: loadedKg,
            emptyWeightKg,
            netWeightKg: netKg.toNumber(),
            declaredWeightKg: Number(receipt.declaredWeightKg),
            declaredDiffKg: netKg.minus(receipt.declaredWeightKg).toNumber(),
            declaredDiffExceeded,
            weightOvershoot,
            pieceOvershoots,
            acceptedPieces: receipt.pieceLines.map((l) => ({
              billetLengthM: l.billetLengthM,
              accepted: Math.max(0, (l.countedPieces ?? 0) - l.rejectedPieces),
            })),
          },
        });

        if (declaredDiffExceeded) {
          logger.warn(
            { receiptId, declaredDiffKg: declaredDiffKg.toNumber() },
            "billet net weight differs from declared beyond threshold",
          );
        }
        logger.info({ receiptId, netKg: netKg.toNumber() }, "billet receipt completed");
        return updated;
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

// ─── Attachments (generic, optional — allowed until cancelled) ─────

export async function addAttachment(
  receiptId: number,
  fileInfo: { filePath: string; fileName: string; fileSize: number },
  userId: number,
) {
  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const receipt = await tx.billetReceipt.findUnique({ where: { id: receiptId } });
        if (!receipt) throw new ServiceError("سجل الاستلام غير موجود", "NOT_FOUND");
        if (receipt.status === "Cancelled") {
          throw new ServiceError("لا يمكن إضافة مرفقات لسجل ملغى");
        }

        const att = await tx.billetReceiptAttachment.create({
          data: {
            billetReceiptId: receiptId,
            filePath: fileInfo.filePath,
            fileName: fileInfo.fileName,
            fileSize: fileInfo.fileSize || 0,
            uploadedById: userId,
          },
        });

        await logAudit(tx, {
          userId,
          action: "upload",
          entityType: "BilletReceiptAttachment",
          entityId: String(receiptId),
          details: {
            fileName: fileInfo.fileName,
            fileSize: fileInfo.fileSize,
            receiptStatus: receipt.status,
            postCompletion: receipt.status === "Completed",
          },
        });

        return att;
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

// ─── Cancel ────────────────────────────────────────────────────────

export async function cancelReceipt(receiptId: number, reason: string, userId: number) {
  if (!reason.trim()) throw new ServiceError("يجب إدخال سبب الإلغاء");

  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await lockReceipt(tx, receiptId);
        const receipt = await tx.billetReceipt.findUnique({ where: { id: receiptId } });
        if (!receipt) throw new ServiceError("سجل الاستلام غير موجود", "NOT_FOUND");

        assertTransition(receipt.status, "Cancelled");

        const updated = await tx.billetReceipt.update({
          where: { id: receiptId },
          data: {
            status: "Cancelled",
            cancelReason: reason.trim(),
            closedById: userId,
            closedAt: new Date(),
            version: { increment: 1 },
          },
        });

        await logAudit(tx, {
          userId,
          action: "status_change",
          entityType: "BilletReceipt",
          entityId: String(receiptId),
          details: {
            event: "receipt_cancelled",
            previousValue: { status: receipt.status },
            newValue: { status: "Cancelled", cancelReason: reason.trim() },
          },
        });

        logger.info({ receiptId, reason }, "billet receipt cancelled");
        return updated;
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

// ─── Queries ───────────────────────────────────────────────────────

const DETAIL_INCLUDE = {
  contract: {
    select: {
      contractNumber: true,
      supplierName: true,
      status: true,
      contractedWeightKg: true,
    },
  },
  pieceLines: { orderBy: { billetLengthM: "asc" as const } },
  attachments: {
    orderBy: { uploadedAt: "desc" as const },
    include: { uploader: { select: { username: true, fullName: true } } },
  },
  creator: { select: { id: true, username: true, fullName: true } },
  closer: { select: { id: true, username: true, fullName: true } },
} as const;

export type BilletReceiptDetail = Prisma.BilletReceiptGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

export async function getReceipt(receiptId: number): Promise<BilletReceiptDetail> {
  const receipt = await prisma.billetReceipt.findUnique({
    where: { id: receiptId },
    include: DETAIL_INCLUDE,
  });
  if (!receipt) throw new ServiceError("سجل الاستلام غير موجود", "NOT_FOUND");
  return receipt;
}

export interface ReceiptListFilters {
  status?: BilletReceiptStatus;
  plateNumber?: string;
  supplierContractNumber?: string;
}

export type ReceiptListItem = Prisma.BilletReceiptGetPayload<{
  include: {
    contract: { select: { contractNumber: true; supplierName: true } };
    pieceLines: true;
    creator: { select: { id: true; fullName: true } };
    _count: { select: { attachments: true } };
  };
}>;

export async function listReceipts(
  filters: ReceiptListFilters,
  pagination: PaginationParams,
): Promise<PaginatedResult<ReceiptListItem>> {
  const where: Prisma.BilletReceiptWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.plateNumber) {
    where.plateNumber = { contains: filters.plateNumber, mode: "insensitive" };
  }
  if (filters.supplierContractNumber) {
    where.supplierContractNumber = filters.supplierContractNumber;
  }

  const [data, total] = await Promise.all([
    prisma.billetReceipt.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      include: {
        contract: { select: { contractNumber: true, supplierName: true } },
        pieceLines: { orderBy: { billetLengthM: "asc" } },
        creator: { select: { id: true, fullName: true } },
        _count: { select: { attachments: true } },
      },
    }),
    prisma.billetReceipt.count({ where }),
  ]);

  return { data, total, page: pagination.page, pageSize: pagination.pageSize };
}
