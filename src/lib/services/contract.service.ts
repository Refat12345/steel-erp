import { prisma } from "@/lib/db";
import { Prisma, type ContractStatus } from "@prisma/client";
import type { ContractCreateInput, ContractUpdateInput } from "@/lib/validators/contract";
import type { PaginationParams, PaginatedResult } from "@/lib/api-utils";
import { ServiceError } from "./errors";
import { logAudit } from "./audit.service";
import { logger } from "@/lib/logger";

export interface AttachmentInfo {
  path: string;
  name: string;
  size: number;
}

type ContractListItem = Prisma.MasterContractGetPayload<{
  include: {
    customer: { select: { id: true; code: true; fullName: true; phonePrimary: true } };
    _count: { select: { attachments: true } };
  };
}>;

export async function listContracts(
  search: string,
  status: string,
  pagination: PaginationParams,
): Promise<PaginatedResult<ContractListItem>> {
  const where: Prisma.MasterContractWhereInput = {};
  if (status) where.status = status as Prisma.EnumContractStatusFilter;
  if (search) {
    where.OR = [
      { contractNumber: { contains: search, mode: "insensitive" } },
      {
        customer: {
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { code: { contains: search, mode: "insensitive" } },
          ],
        },
      },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.masterContract.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        customer: {
          select: { id: true, code: true, fullName: true, phonePrimary: true },
        },
        _count: { select: { attachments: true } },
      },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
    prisma.masterContract.count({ where }),
  ]);

  return { data, total, page: pagination.page, pageSize: pagination.pageSize };
}

export async function createContract(
  data: ContractCreateInput,
  attachment: AttachmentInfo,
  createdById: number,
) {
  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
  });
  if (!customer || !customer.isActive) {
    throw new ServiceError("العميل غير موجود أو غير نشط");
  }

  const currentYear = new Date().getFullYear();
  const yy = String(currentYear).slice(-2);

  const existingContract = await prisma.masterContract.findFirst({
    where: {
      customerId: data.customerId,
      contractNumber: { startsWith: `${yy}-` },
    },
  });
  if (existingContract) {
    throw new ServiceError(
      `العميل لديه عقد لهذه السنة بالفعل: ${existingContract.contractNumber} (${existingContract.status === "active" ? "نشط" : existingContract.status === "suspended" ? "معلّق" : "مغلق"})`,
    );
  }

  const MAX_ATTEMPTS = 3;
  let contract;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      contract = await prisma.$transaction(async (tx) => {
        const allContracts = await tx.masterContract.findMany({
          where: { contractNumber: { startsWith: `${yy}-` } },
          select: { contractNumber: true },
        });

        let maxSeq = 0;
        for (const c of allContracts) {
          const seq = parseInt(c.contractNumber.split("-")[1], 10);
          if (seq > maxSeq) maxSeq = seq;
        }
        const contractNumber = `${yy}-${String(maxSeq + 1).padStart(2, "0")}`;

        const created = await tx.masterContract.create({
          data: {
            contractNumber,
            customerId: data.customerId,
            attachmentPath: attachment.path,
            notes: data.notes || null,
            createdById,
          },
          include: {
            customer: { select: { id: true, code: true, fullName: true } },
          },
        });

        if (attachment.name) {
          await tx.contractAttachment.create({
            data: {
              contractNumber,
              filePath: attachment.path,
              fileName: attachment.name,
              fileSize: attachment.size,
              uploadedById: createdById,
            },
          });
        }

        await logAudit(tx, {
          userId: createdById,
          action: "create",
          entityType: "MasterContract",
          entityId: contractNumber,
          details: { customerId: data.customerId },
        });

        return created;
      }, { isolationLevel: "Serializable" });

      break;
    } catch (e) {
      const isRetryable =
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (e.code === "P2002" || e.code === "P2034");
      if (isRetryable && attempt < MAX_ATTEMPTS - 1) continue;
      throw e;
    }
  }

  logger.info({ contractNumber: contract!.contractNumber }, "contract created");
  return contract!;
}

export async function getContractByNumber(contractNumber: string) {
  const contract = await prisma.masterContract.findUnique({
    where: { contractNumber },
    include: {
      customer: true,
      creator: { select: { username: true, fullName: true } },
      attachments: {
        orderBy: { uploadedAt: "desc" },
        include: { uploader: { select: { username: true, fullName: true } } },
      },
    },
  });
  if (!contract) throw new ServiceError("العقد غير موجود", "NOT_FOUND");
  return contract;
}

export async function updateContract(contractNumber: string, data: ContractUpdateInput, updatedById: number) {
  const existing = await prisma.masterContract.findUnique({
    where: { contractNumber },
  });
  if (!existing) throw new ServiceError("العقد غير موجود", "NOT_FOUND");

  const isStatusChange = data.status && data.status !== existing.status;
  if (isStatusChange && !data.statusReason) {
    throw new ServiceError("سبب تغيير الحالة مطلوب");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.masterContract.update({
      where: { contractNumber },
      data: {
        ...(data.notes !== undefined && { notes: data.notes || null }),
        ...(data.status && { status: data.status as ContractStatus }),
        updatedById,
      },
      include: {
        customer: { select: { id: true, code: true, fullName: true } },
      },
    });

    if (isStatusChange) {
      await logAudit(tx, {
        userId: updatedById,
        action: "status_change",
        entityType: "MasterContract",
        entityId: contractNumber,
        details: { from: existing.status, to: data.status, reason: data.statusReason },
      });
      logger.info({ contractNumber, from: existing.status, to: data.status }, "contract status changed");
    } else {
      await logAudit(tx, {
        userId: updatedById,
        action: "update",
        entityType: "MasterContract",
        entityId: contractNumber,
        details: JSON.parse(JSON.stringify(data)),
      });
      logger.info({ contractNumber }, "contract updated");
    }

    return result;
  });

  return updated;
}

export async function addAttachment(
  contractNumber: string,
  fileInfo: { filePath: string; fileName: string; fileSize: number },
  uploadedById: number,
) {
  const contract = await prisma.masterContract.findUnique({
    where: { contractNumber },
  });
  if (!contract) throw new ServiceError("العقد غير موجود", "NOT_FOUND");

  const attachment = await prisma.$transaction(async (tx) => {
    const att = await tx.contractAttachment.create({
      data: {
        contractNumber,
        filePath: fileInfo.filePath,
        fileName: fileInfo.fileName,
        fileSize: fileInfo.fileSize || 0,
        uploadedById,
      },
    });

    await logAudit(tx, {
      userId: uploadedById,
      action: "upload",
      entityType: "ContractAttachment",
      entityId: contractNumber,
      details: { fileName: fileInfo.fileName, fileSize: fileInfo.fileSize },
    });

    return att;
  });

  logger.info({ contractNumber, fileName: fileInfo.fileName }, "attachment uploaded");
  return attachment;
}
