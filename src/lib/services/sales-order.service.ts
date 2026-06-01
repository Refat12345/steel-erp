import { prisma } from "@/lib/db";
import { Prisma, type SalesOrderKind, type SalesOrderStatus } from "@prisma/client";
import type { SalesOrderCreateInput, SalesOrderUpdateInput } from "@/lib/validators/sales-order";
import type { PaginationParams, PaginatedResult } from "@/lib/api-utils";
import { ServiceError } from "./errors";
import { logAudit } from "./audit.service";
import { logger } from "@/lib/logger";

type SalesOrderListItem = Prisma.SalesOrderGetPayload<{
  include: {
    contract: {
      select: {
        contractNumber: true;
        customer: { select: { id: true; code: true; fullName: true } };
      };
    };
    _count: { select: { items: true } };
  };
}>;

export async function listSalesOrders(
  search: string,
  status: string,
  kind: string,
  contractNumber: string,
  pagination: PaginationParams,
): Promise<PaginatedResult<SalesOrderListItem>> {
  const where: Prisma.SalesOrderWhereInput = {};
  if (status) where.status = status as SalesOrderStatus;
  if (kind) where.kind = kind as SalesOrderKind;
  if (contractNumber) where.contractNumber = contractNumber;
  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: "insensitive" } },
      {
        contract: {
          customer: {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { code: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.salesOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        contract: {
          select: {
            contractNumber: true,
            customer: { select: { id: true, code: true, fullName: true } },
          },
        },
        _count: { select: { items: true } },
      },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
    prisma.salesOrder.count({ where }),
  ]);

  return { data, total, page: pagination.page, pageSize: pagination.pageSize };
}

export async function getSalesOrderByNumber(orderNumber: string) {
  const so = await prisma.salesOrder.findUnique({
    where: { orderNumber },
    include: {
      contract: {
        select: {
          contractNumber: true,
          status: true,
          customer: {
            select: {
              id: true,
              code: true,
              fullName: true,
              phonePrimary: true,
              nationalId: true,
            },
          },
        },
      },
      items: {
        include: { size: { select: { id: true, code: true, displayName: true } } },
        orderBy: { size: { sortOrder: "asc" } },
      },
      creator: { select: { username: true, fullName: true } },
      updater: { select: { username: true, fullName: true } },
    },
  });
  if (!so) throw new ServiceError("أمر البيع غير موجود", "NOT_FOUND");
  return so;
}

export async function createSalesOrder(
  data: SalesOrderCreateInput,
  createdById: number,
) {
  const contract = await prisma.masterContract.findUnique({
    where: { contractNumber: data.contractNumber },
    select: { contractNumber: true, status: true, customerId: true },
  });
  if (!contract) throw new ServiceError("العقد غير موجود");
  if (contract.status !== "active") {
    throw new ServiceError("العقد غير نشط — لا يمكن إنشاء أمر بيع تحته");
  }

  // Check for duplicate kind+grade on same contract
  const duplicateWhere: Prisma.SalesOrderWhereInput = {
    contractNumber: data.contractNumber,
    kind: data.kind as SalesOrderKind,
    status: { notIn: ["cancelled"] },
  };
  if (data.kind === "REBAR" && data.grade) {
    duplicateWhere.grade = data.grade;
  }
  const existing = await prisma.salesOrder.findFirst({ where: duplicateWhere });
  if (existing) {
    const kindLabel = KIND_LABELS[data.kind] || data.kind;
    const gradeLabel = data.grade ? ` (${GRADE_LABELS[data.grade]})` : "";
    throw new ServiceError(
      `يوجد أمر بيع ${kindLabel}${gradeLabel} على هذا العقد بالفعل: ${existing.orderNumber}`
    );
  }

  const MAX_ATTEMPTS = 3;
  let result;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      result = await prisma.$transaction(async (tx) => {
        const allSOs = await tx.salesOrder.findMany({
          where: { contractNumber: data.contractNumber },
          select: { orderNumber: true },
        });

        let maxSeq = 0;
        for (const so of allSOs) {
          const seq = parseInt(so.orderNumber.split("-").pop()!, 10);
          if (seq > maxSeq) maxSeq = seq;
        }
        const orderNumber = `${data.contractNumber}-${String(maxSeq + 1).padStart(3, "0")}`;

        const created = await tx.salesOrder.create({
          data: {
            orderNumber,
            contractNumber: data.contractNumber,
            kind: data.kind,
            grade: data.kind === "REBAR" ? data.grade : null,
            settlementMode: data.settlementMode,
            paymentDeadlineDays:
              data.settlementMode === "CREDIT" ? data.paymentDeadlineDays! : null,
            totalQtyTons: data.totalQtyTons,
            toleranceType: data.toleranceType,
            toleranceValue: data.toleranceValue,
            specialRatioPct: data.kind === "REBAR" ? (data.specialRatioPct ?? 0) : null,
            orderDate: new Date(data.orderDate),
            deliveryDate: new Date(data.deliveryDate),
            notes: data.notes || null,
            createdById,
          },
          include: {
            contract: {
              select: {
                contractNumber: true,
                customer: { select: { id: true, code: true, fullName: true } },
              },
            },
          },
        });

        await logAudit(tx, {
          userId: createdById,
          action: "create",
          entityType: "SalesOrder",
          entityId: orderNumber,
          details: {
            kind: data.kind,
            grade: data.grade,
            settlementMode: data.settlementMode,
            totalQtyTons: data.totalQtyTons,
          },
        });

        return created;
      });

      break;
    } catch (e) {
      const isRetryable =
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (e.code === "P2002" || e.code === "P2034");
      if (isRetryable && attempt < MAX_ATTEMPTS - 1) continue;
      throw e;
    }
  }

  logger.info({ orderNumber: result!.orderNumber }, "Sales order created");
  return result!;
}

export async function updateSalesOrder(
  orderNumber: string,
  data: SalesOrderUpdateInput,
  updatedById: number,
) {
  const so = await prisma.salesOrder.findUnique({
    where: { orderNumber },
    select: { orderNumber: true, status: true },
  });
  if (!so) throw new ServiceError("أمر البيع غير موجود", "NOT_FOUND");

  if (data.status) {
    validateStatusTransition(so.status, data.status);
  }

  const updateData: Prisma.SalesOrderUpdateInput = { updater: { connect: { id: updatedById } } };
  if (data.status) updateData.status = data.status;
  if (data.notes !== undefined) updateData.notes = data.notes || null;
  if (data.totalQtyTons !== undefined) updateData.totalQtyTons = data.totalQtyTons;
  if (data.toleranceType !== undefined) updateData.toleranceType = data.toleranceType;
  if (data.toleranceValue !== undefined) updateData.toleranceValue = data.toleranceValue;
  if (data.specialRatioPct !== undefined) updateData.specialRatioPct = data.specialRatioPct;
  if (data.deliveryDate !== undefined) updateData.deliveryDate = new Date(data.deliveryDate);

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.salesOrder.update({
      where: { orderNumber },
      data: updateData,
      include: {
        contract: {
          select: {
            contractNumber: true,
            customer: { select: { id: true, code: true, fullName: true } },
          },
        },
        items: {
          include: { size: { select: { id: true, code: true, displayName: true } } },
          orderBy: { size: { sortOrder: "asc" } },
        },
      },
    });

    const action = data.status ? "status_change" : "update";
    await logAudit(tx, {
      userId: updatedById,
      action,
      entityType: "SalesOrder",
      entityId: orderNumber,
      details: data,
    });

    return result;
  });

  logger.info({ orderNumber, changes: Object.keys(data) }, "Sales order updated");
  return updated;
}

export async function setOrderItems(
  orderNumber: string,
  items: Array<{ sizeId: number; pricePerTon: number }>,
  userId: number,
) {
  const so = await prisma.salesOrder.findUnique({
    where: { orderNumber },
    select: { orderNumber: true, status: true, kind: true },
  });
  if (!so) throw new ServiceError("أمر البيع غير موجود", "NOT_FOUND");
  if (so.status !== "draft" && so.status !== "approved") {
    throw new ServiceError("لا يمكن تعديل الأسعار بعد بدء التنفيذ");
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.orderItem.deleteMany({ where: { orderNumber } });
    const created = await Promise.all(
      items.map((item) =>
        tx.orderItem.create({
          data: {
            orderNumber,
            sizeId: item.sizeId,
            pricePerTon: item.pricePerTon,
          },
          include: { size: { select: { id: true, code: true, displayName: true } } },
        })
      )
    );

    await logAudit(tx, {
      userId,
      action: "update",
      entityType: "SalesOrder",
      entityId: orderNumber,
      details: { action: "set_prices", itemCount: items.length },
    });

    return created;
  });

  logger.info({ orderNumber, itemCount: items.length }, "Order items set");
  return result;
}

function validateStatusTransition(current: string, next: string) {
  const allowed: Record<string, string[]> = {
    draft: ["approved", "cancelled"],
    approved: ["in_progress", "cancelled"],
    in_progress: ["completed"],
    completed: [],
    cancelled: [],
  };
  if (!allowed[current]?.includes(next)) {
    throw new ServiceError(
      `لا يمكن تغيير الحالة من "${STATUS_LABELS[current]}" إلى "${STATUS_LABELS[next]}"`
    );
  }
}

const KIND_LABELS: Record<string, string> = {
  REBAR: "مبروم",
  SHORTBAR_1_4M: "قصائر 1–4 م",
  SHORTBAR_4_12M: "قصائر 4–12 م",
  SCRAP: "خردة",
};

const GRADE_LABELS: Record<string, string> = {
  FIRST: "نخب أول",
  SECOND: "نخب ثاني",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  approved: "معتمد",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  cancelled: "ملغى",
};
