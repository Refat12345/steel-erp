import { prisma } from "@/lib/db";
import { Prisma, type SupplierContractStatus } from "@prisma/client";
import Decimal from "decimal.js";
import type {
  BilletContractCreateInput,
  BilletContractUpdateInput,
} from "@/lib/validators/billet-contract";
import type { PaginationParams, PaginatedResult } from "@/lib/api-utils";
import { ServiceError } from "./errors";
import { logAudit } from "./audit.service";
import { withRetry } from "./tx-retry";
import { logger } from "@/lib/logger";

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type ContractUsageClient = Pick<TxClient, "billetReceipt">;

type ContractListItem = Prisma.SupplierContractGetPayload<{
  include: {
    pieceLines: true;
    _count: { select: { receipts: true } };
  };
}>;

export async function listContracts(
  search: string,
  status: string,
  pagination: PaginationParams,
): Promise<PaginatedResult<ContractListItem>> {
  const where: Prisma.SupplierContractWhereInput = {};
  if (status) where.status = status as SupplierContractStatus;
  if (search) {
    where.OR = [
      { contractNumber: { contains: search, mode: "insensitive" } },
      { supplierName: { contains: search, mode: "insensitive" } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.supplierContract.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        pieceLines: { orderBy: { billetLengthM: "asc" } },
        _count: { select: { receipts: true } },
      },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
    prisma.supplierContract.count({ where }),
  ]);

  return { data, total, page: pagination.page, pageSize: pagination.pageSize };
}

async function generateContractNumber(tx: TxClient): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `P-${yy}-`;
  const existing = await tx.supplierContract.findMany({
    where: { contractNumber: { startsWith: prefix } },
    select: { contractNumber: true },
  });
  let maxSeq = 0;
  for (const c of existing) {
    const seq = parseInt(c.contractNumber.slice(prefix.length), 10);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
}

export async function createContract(
  data: BilletContractCreateInput,
  createdById: number,
) {
  // Reject duplicate lengths defensively (validator already checks this).
  const lengths = data.pieceLines.map((l) => l.billetLengthM);
  if (new Set(lengths).size !== lengths.length) {
    throw new ServiceError("لا يمكن تكرار نفس الطول في العقد");
  }

  const contractDate = data.contractDate ? new Date(data.contractDate) : new Date();
  if (data.contractDate && isNaN(contractDate.getTime())) {
    throw new ServiceError("تاريخ العقد غير صالح");
  }

  const contract = await withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const contractNumber = await generateContractNumber(tx);

        const created = await tx.supplierContract.create({
          data: {
            contractNumber,
            supplierName: data.supplierName.trim(),
            contractedWeightKg: new Decimal(data.contractedWeightKg).toFixed(3),
            contractDate,
            notes: data.notes?.trim() || null,
            createdById,
            pieceLines: {
              create: data.pieceLines.map((l) => ({
                billetLengthM: l.billetLengthM,
                contractedPieces: l.contractedPieces,
              })),
            },
          },
          include: { pieceLines: { orderBy: { billetLengthM: "asc" } } },
        });

        await logAudit(tx, {
          userId: createdById,
          action: "create",
          entityType: "SupplierContract",
          entityId: contractNumber,
          details: {
            supplierName: created.supplierName,
            contractedWeightKg: Number(created.contractedWeightKg),
            pieceLines: data.pieceLines,
          },
        });

        return created;
      },
      { isolationLevel: "Serializable" },
    ),
  );

  logger.info({ contractNumber: contract.contractNumber }, "billet contract created");
  return contract;
}

export interface PieceLineBalance {
  billetLengthM: number;
  contractedPieces: number;
  acceptedPieces: number;
  remainingPieces: number;
}

export interface ContractWithBalance {
  contract: Prisma.SupplierContractGetPayload<{
    include: {
      pieceLines: true;
      creator: { select: { username: true; fullName: true } };
    };
  }>;
  contractedWeightKg: string;
  receivedWeightKg: string;
  remainingWeightKg: string;
  pieceBalances: PieceLineBalance[];
  receipts: {
    id: number;
    receiptNumber: string;
    status: string;
    plateNumber: string;
    driverName: string;
    netWeightKg: string | null;
    createdAt: Date;
  }[];
}

async function getCompletedUsage(db: ContractUsageClient, contractNumber: string) {
  const completedReceipts = await db.billetReceipt.findMany({
    where: { supplierContractNumber: contractNumber, status: "Completed" },
    select: { netWeightKg: true, pieceLines: true },
  });

  let receivedWeight = new Decimal(0);
  const acceptedByLength = new Map<number, number>();
  for (const r of completedReceipts) {
    if (r.netWeightKg != null) receivedWeight = receivedWeight.plus(r.netWeightKg);
    for (const line of r.pieceLines) {
      const accepted = Math.max(0, (line.countedPieces ?? 0) - line.rejectedPieces);
      acceptedByLength.set(
        line.billetLengthM,
        (acceptedByLength.get(line.billetLengthM) ?? 0) + accepted,
      );
    }
  }

  return { receivedWeight, acceptedByLength };
}

/**
 * Contract detail with DERIVED remaining balances. Nothing is stored —
 * received weight and accepted pieces are summed from Completed receipts so
 * the balance can never drift from the source-of-truth receipt rows.
 */
export async function getContractWithBalance(
  contractNumber: string,
): Promise<ContractWithBalance> {
  const contract = await prisma.supplierContract.findUnique({
    where: { contractNumber },
    include: {
      pieceLines: { orderBy: { billetLengthM: "asc" } },
      creator: { select: { username: true, fullName: true } },
    },
  });
  if (!contract) throw new ServiceError("العقد غير موجود", "NOT_FOUND");

  const { receivedWeight, acceptedByLength } = await getCompletedUsage(
    prisma,
    contractNumber,
  );

  const contractedWeight = new Decimal(contract.contractedWeightKg);
  const pieceBalances: PieceLineBalance[] = contract.pieceLines.map((l) => {
    const accepted = acceptedByLength.get(l.billetLengthM) ?? 0;
    return {
      billetLengthM: l.billetLengthM,
      contractedPieces: l.contractedPieces,
      acceptedPieces: accepted,
      remainingPieces: l.contractedPieces - accepted,
    };
  });

  const recentReceipts = await prisma.billetReceipt.findMany({
    where: { supplierContractNumber: contractNumber },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      receiptNumber: true,
      status: true,
      plateNumber: true,
      driverName: true,
      netWeightKg: true,
      createdAt: true,
    },
  });

  return {
    contract,
    contractedWeightKg: contractedWeight.toFixed(3),
    receivedWeightKg: receivedWeight.toFixed(3),
    remainingWeightKg: contractedWeight.minus(receivedWeight).toFixed(3),
    pieceBalances,
    receipts: recentReceipts.map((r) => ({
      ...r,
      netWeightKg: r.netWeightKg != null ? r.netWeightKg.toString() : null,
    })),
  };
}

export async function updateContract(
  contractNumber: string,
  data: BilletContractUpdateInput,
  updatedById: number,
) {
  const lengths = data.pieceLines?.map((l) => l.billetLengthM);
  if (lengths && new Set(lengths).size !== lengths.length) {
    throw new ServiceError("لا يمكن تكرار نفس الطول في العقد");
  }

  const updated = await withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const existing = await tx.supplierContract.findUnique({
          where: { contractNumber },
          include: { pieceLines: { orderBy: { billetLengthM: "asc" } } },
        });
        if (!existing) throw new ServiceError("العقد غير موجود", "NOT_FOUND");

        const isStatusChange = data.status != null && data.status !== existing.status;
        if (isStatusChange && !data.statusReason) {
          throw new ServiceError("سبب تغيير الحالة مطلوب");
        }

        const { receivedWeight, acceptedByLength } = await getCompletedUsage(
          tx,
          contractNumber,
        );

        if (
          data.contractedWeightKg !== undefined &&
          new Decimal(data.contractedWeightKg).lt(receivedWeight)
        ) {
          throw new ServiceError(
            `لا يمكن جعل الوزن الإجمالي أقل من الوزن المستلَم (${receivedWeight.toFixed(3)} كغ)`,
          );
        }

        if (data.pieceLines) {
          const requestedLengths = new Set(
            data.pieceLines.map((l) => l.billetLengthM),
          );
          for (const [lengthM, acceptedPieces] of acceptedByLength.entries()) {
            if (!requestedLengths.has(lengthM) && acceptedPieces > 0) {
              throw new ServiceError(
                `لا يمكن حذف طول ${lengthM}م لأنه عليه ${acceptedPieces} قطعة مستلمة`,
              );
            }
          }

          for (const line of data.pieceLines) {
            const acceptedPieces = acceptedByLength.get(line.billetLengthM) ?? 0;
            if (line.contractedPieces < acceptedPieces) {
              throw new ServiceError(
                `عدد قطع طول ${line.billetLengthM}م لا يمكن أن يكون أقل من المستلَم (${acceptedPieces})`,
              );
            }
          }
        }

        const result = await tx.supplierContract.update({
          where: { contractNumber },
          data: {
            ...(data.supplierName !== undefined && {
              supplierName: data.supplierName.trim(),
            }),
            ...(data.contractedWeightKg !== undefined && {
              contractedWeightKg: new Decimal(data.contractedWeightKg).toFixed(3),
            }),
            ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
            ...(data.status && { status: data.status as SupplierContractStatus }),
            version: { increment: 1 },
            updatedById,
          },
          include: { pieceLines: { orderBy: { billetLengthM: "asc" } } },
        });

        if (data.pieceLines) {
          await tx.supplierContractPieceLine.deleteMany({
            where: {
              supplierContractNumber: contractNumber,
              billetLengthM: { notIn: data.pieceLines.map((l) => l.billetLengthM) },
            },
          });

          for (const line of data.pieceLines) {
            await tx.supplierContractPieceLine.upsert({
              where: {
                supplierContractNumber_billetLengthM: {
                  supplierContractNumber: contractNumber,
                  billetLengthM: line.billetLengthM,
                },
              },
              create: {
                supplierContractNumber: contractNumber,
                billetLengthM: line.billetLengthM,
                contractedPieces: line.contractedPieces,
              },
              update: { contractedPieces: line.contractedPieces },
            });
          }
        }

        await logAudit(tx, {
          userId: updatedById,
          action: isStatusChange ? "status_change" : "update",
          entityType: "SupplierContract",
          entityId: contractNumber,
          details: isStatusChange
            ? { from: existing.status, to: data.status, reason: data.statusReason }
            : (JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue),
        });

        return tx.supplierContract.findUniqueOrThrow({
          where: { contractNumber: result.contractNumber },
          include: { pieceLines: { orderBy: { billetLengthM: "asc" } } },
        });
      },
      { isolationLevel: "Serializable" },
    ),
  );

  logger.info(
    { contractNumber, statusChanged: data.status != null },
    "billet contract updated",
  );
  return updated;
}
