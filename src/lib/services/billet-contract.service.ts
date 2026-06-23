import { prisma } from "@/lib/db";
import { Prisma, type SupplierContractStatus } from "@prisma/client";
import Decimal from "decimal.js";
import type {
  BilletContractCreateInput,
  BilletContractUpdateInput,
  PriorWithdrawalInput,
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

async function generatePriorWithdrawalNumber(tx: TxClient): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `PW-${yy}-`;
  const existing = await tx.billetReceipt.findMany({
    where: { receiptNumber: { startsWith: prefix } },
    select: { receiptNumber: true },
  });
  let maxSeq = 0;
  for (const receipt of existing) {
    const seq = parseInt(receipt.receiptNumber.slice(prefix.length), 10);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
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
    isPriorWithdrawal: boolean;
    priorWithdrawalDate: Date | null;
    createdAt: Date;
  }[];
  attachments: {
    id: number;
    fileName: string;
    filePath: string;
    fileSize: number;
    uploadedAt: Date;
    uploadedBy: string | null;
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
      isPriorWithdrawal: true,
      priorWithdrawalDate: true,
      createdAt: true,
    },
  });

  const attachments = await prisma.supplierContractAttachment.findMany({
    where: { supplierContractNumber: contractNumber },
    orderBy: { uploadedAt: "desc" },
    include: { uploader: { select: { fullName: true, username: true } } },
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
    attachments: attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      filePath: a.filePath,
      fileSize: a.fileSize,
      uploadedAt: a.uploadedAt,
      uploadedBy: a.uploader.fullName || a.uploader.username,
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

        const { acceptedByLength } = await getCompletedUsage(
          tx,
          contractNumber,
        );

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

export async function recordPriorWithdrawal(
  contractNumber: string,
  data: PriorWithdrawalInput,
  userId: number,
) {
  const lengths = data.pieceLines.map((line) => line.billetLengthM);
  if (new Set(lengths).size !== lengths.length) {
    throw new ServiceError("لا يمكن تكرار نفس الطول");
  }

  const withdrawalDate = data.withdrawalDate
    ? new Date(data.withdrawalDate)
    : null;
  if (data.withdrawalDate && withdrawalDate && isNaN(withdrawalDate.getTime())) {
    throw new ServiceError("تاريخ السحب السابق غير صالح");
  }

  const receipt = await withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT contract_number FROM supplier_contracts
          WHERE contract_number = ${contractNumber} FOR UPDATE
        `;

        const contract = await tx.supplierContract.findUnique({
          where: { contractNumber },
          include: { pieceLines: true },
        });
        if (!contract) throw new ServiceError("العقد غير موجود", "NOT_FOUND");
        if (contract.status !== "Active") {
          throw new ServiceError("لا يمكن تسجيل سحب سابق على عقد غير فعّال");
        }

        const contractLines = new Map(
          contract.pieceLines.map((line) => [line.billetLengthM, line]),
        );
        for (const line of data.pieceLines) {
          if (!contractLines.has(line.billetLengthM)) {
            throw new ServiceError(
              `الطول ${line.billetLengthM}م غير موجود في عقد المورّد`,
            );
          }
        }

        const netWeight = new Decimal(data.netWeightKg);

        const receiptNumber = await generatePriorWithdrawalNumber(tx);
        const now = new Date();
        const created = await tx.billetReceipt.create({
          data: {
            receiptNumber,
            supplierContractNumber: contractNumber,
            driverName: "سحب سابق قبل النظام",
            plateNumber: "سحب سابق",
            declaredWeightKg: netWeight.toFixed(3),
            status: "Completed",
            netWeightKg: netWeight.toFixed(1),
            notes: data.notes.trim(),
            isPriorWithdrawal: true,
            priorWithdrawalDate: withdrawalDate,
            createdById: userId,
            closedById: userId,
            closedAt: now,
            pieceLines: {
              create: data.pieceLines.map((line) => ({
                billetLengthM: line.billetLengthM,
                expectedPieces: line.acceptedPieces,
                countedPieces: line.acceptedPieces,
                rejectedPieces: 0,
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
            event: "prior_withdrawal_recorded",
            receiptNumber,
            supplierContractNumber: contractNumber,
            netWeightKg: netWeight.toNumber(),
            withdrawalDate: withdrawalDate?.toISOString() ?? null,
            pieceLines: data.pieceLines,
            notes: data.notes.trim(),
          },
        });

        return created;
      },
      { isolationLevel: "Serializable" },
    ),
  );

  logger.info(
    {
      contractNumber,
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
    },
    "billet prior withdrawal recorded",
  );
  return receipt;
}

export async function addContractAttachment(
  contractNumber: string,
  fileInfo: { filePath: string; fileName: string; fileSize: number },
  userId: number,
) {
  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const contract = await tx.supplierContract.findUnique({
          where: { contractNumber },
          select: { contractNumber: true },
        });
        if (!contract) throw new ServiceError("العقد غير موجود", "NOT_FOUND");

        const att = await tx.supplierContractAttachment.create({
          data: {
            supplierContractNumber: contractNumber,
            filePath: fileInfo.filePath,
            fileName: fileInfo.fileName,
            fileSize: fileInfo.fileSize || 0,
            uploadedById: userId,
          },
        });

        await logAudit(tx, {
          userId,
          action: "upload",
          entityType: "SupplierContractAttachment",
          entityId: contractNumber,
          details: { fileName: fileInfo.fileName, fileSize: fileInfo.fileSize },
        });

        return att;
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

// ── Billet balance report (cumulative, completed receipts only) ─────────────

export interface BilletBalancePieceRow {
  billetLengthM: number;
  contractedPieces: number;
  acceptedPieces: number;
  remainingPieces: number;
}

export interface BilletBalanceContractRow {
  contractNumber: string;
  status: SupplierContractStatus;
  contractedWeightKg: number;
  receivedWeightKg: number;
  remainingWeightKg: number;
  pieceBalances: BilletBalancePieceRow[];
  completedReceiptCount: number;
}

export interface BilletBalanceReceiptRow {
  id: number;
  receiptNumber: string;
  contractNumber: string;
  completedAt: string | null;
  plateNumber: string;
  driverName: string;
  netWeightKg: number | null;
  isPriorWithdrawal: boolean;
  priorWithdrawalDate: string | null;
  acceptedByLength: Record<string, number>;
}

export interface BilletBalanceReport {
  generatedAt: string;
  filters: {
    supplierName: string;
    contractNumber: string | null;
  };
  lengthColumns: number[];
  totals: {
    contractedWeightKg: number;
    receivedWeightKg: number;
    remainingWeightKg: number;
    completedReceiptCount: number;
  };
  pieceTotals: BilletBalancePieceRow[];
  contracts: BilletBalanceContractRow[];
  receipts: BilletBalanceReceiptRow[];
}

export interface BilletSupplierOption {
  supplierName: string;
  contractCount: number;
  contracts: {
    contractNumber: string;
    status: SupplierContractStatus;
  }[];
}

function buildPieceBalances(
  pieceLines: { billetLengthM: number; contractedPieces: number }[],
  acceptedByLength: Map<number, number>,
): BilletBalancePieceRow[] {
  return pieceLines.map((line) => {
    const accepted = acceptedByLength.get(line.billetLengthM) ?? 0;
    return {
      billetLengthM: line.billetLengthM,
      contractedPieces: line.contractedPieces,
      acceptedPieces: accepted,
      remainingPieces: line.contractedPieces - accepted,
    };
  });
}

function mergePieceTotals(rows: BilletBalancePieceRow[]): BilletBalancePieceRow[] {
  const byLength = new Map<number, BilletBalancePieceRow>();
  for (const row of rows) {
    const existing = byLength.get(row.billetLengthM);
    if (!existing) {
      byLength.set(row.billetLengthM, { ...row });
      continue;
    }
    existing.contractedPieces += row.contractedPieces;
    existing.acceptedPieces += row.acceptedPieces;
    existing.remainingPieces += row.remainingPieces;
  }
  return [...byLength.values()].sort((a, b) => a.billetLengthM - b.billetLengthM);
}

export async function listBilletSuppliers(): Promise<BilletSupplierOption[]> {
  const contracts = await prisma.supplierContract.findMany({
    select: {
      supplierName: true,
      contractNumber: true,
      status: true,
    },
    orderBy: [{ supplierName: "asc" }, { contractNumber: "asc" }],
  });

  const bySupplier = new Map<string, BilletSupplierOption>();
  for (const row of contracts) {
    const existing = bySupplier.get(row.supplierName);
    if (existing) {
      existing.contractCount += 1;
      existing.contracts.push({
        contractNumber: row.contractNumber,
        status: row.status,
      });
      continue;
    }
    bySupplier.set(row.supplierName, {
      supplierName: row.supplierName,
      contractCount: 1,
      contracts: [
        {
          contractNumber: row.contractNumber,
          status: row.status,
        },
      ],
    });
  }

  return [...bySupplier.values()];
}

export async function getBilletBalanceReport(params: {
  supplierName: string;
  contractNumber?: string;
}): Promise<BilletBalanceReport> {
  const supplierName = params.supplierName.trim();
  if (!supplierName) {
    throw new ServiceError("Supplier is required");
  }

  const where: Prisma.SupplierContractWhereInput = {
    supplierName: { equals: supplierName, mode: "insensitive" },
  };
  if (params.contractNumber) {
    where.contractNumber = params.contractNumber;
  }

  const contracts = await prisma.supplierContract.findMany({
    where,
    include: { pieceLines: { orderBy: { billetLengthM: "asc" } } },
    orderBy: { contractNumber: "asc" },
  });

  if (contracts.length === 0) {
    throw new ServiceError("No contracts found for this supplier", "NOT_FOUND");
  }

  const contractRows: BilletBalanceContractRow[] = [];
  let totalContracted = new Decimal(0);
  let totalReceived = new Decimal(0);
  let completedReceiptCount = 0;
  const allPieceRows: BilletBalancePieceRow[] = [];
  const lengthSet = new Set<number>();

  for (const contract of contracts) {
    const { receivedWeight, acceptedByLength } = await getCompletedUsage(
      prisma,
      contract.contractNumber,
    );

    const completedCount = await prisma.billetReceipt.count({
      where: {
        supplierContractNumber: contract.contractNumber,
        status: "Completed",
      },
    });

    const contractedWeight = new Decimal(contract.contractedWeightKg);
    const pieceBalances = buildPieceBalances(contract.pieceLines, acceptedByLength);

    for (const line of pieceBalances) {
      lengthSet.add(line.billetLengthM);
      allPieceRows.push(line);
    }

    totalContracted = totalContracted.plus(contractedWeight);
    totalReceived = totalReceived.plus(receivedWeight);
    completedReceiptCount += completedCount;

    contractRows.push({
      contractNumber: contract.contractNumber,
      status: contract.status,
      contractedWeightKg: contractedWeight.toNumber(),
      receivedWeightKg: receivedWeight.toNumber(),
      remainingWeightKg: contractedWeight.minus(receivedWeight).toNumber(),
      pieceBalances,
      completedReceiptCount: completedCount,
    });
  }

  const contractNumbers = contracts.map((c) => c.contractNumber);
  const receipts = await prisma.billetReceipt.findMany({
    where: {
      supplierContractNumber: { in: contractNumbers },
      status: "Completed",
    },
    orderBy: [{ closedAt: "desc" }, { createdAt: "desc" }],
    include: { pieceLines: true },
  });

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      supplierName: contracts[0]!.supplierName,
      contractNumber: params.contractNumber ?? null,
    },
    lengthColumns: [...lengthSet].sort((a, b) => a - b),
    totals: {
      contractedWeightKg: totalContracted.toNumber(),
      receivedWeightKg: totalReceived.toNumber(),
      remainingWeightKg: totalContracted.minus(totalReceived).toNumber(),
      completedReceiptCount,
    },
    pieceTotals: mergePieceTotals(allPieceRows),
    contracts: contractRows,
    receipts: receipts.map((r) => {
      const acceptedByLength: Record<string, number> = {};
      for (const line of r.pieceLines) {
        const accepted = Math.max(0, (line.countedPieces ?? 0) - line.rejectedPieces);
        if (accepted > 0) {
          acceptedByLength[String(line.billetLengthM)] = accepted;
        }
      }
      return {
        id: r.id,
        receiptNumber: r.receiptNumber,
        contractNumber: r.supplierContractNumber,
        completedAt: (r.closedAt ?? r.exitTime)?.toISOString() ?? null,
        plateNumber: r.plateNumber,
        driverName: r.driverName,
        netWeightKg: r.netWeightKg != null ? Number(r.netWeightKg) : null,
        isPriorWithdrawal: r.isPriorWithdrawal,
        priorWithdrawalDate: r.priorWithdrawalDate?.toISOString() ?? null,
        acceptedByLength,
      };
    }),
  };
}
