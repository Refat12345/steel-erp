import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { CustomerCreateInput, CustomerUpdateInput } from "@/lib/validators/customer";
import type { PaginationParams, PaginatedResult } from "@/lib/api-utils";
import { ServiceError } from "./errors";
import { logAudit } from "./audit.service";
import { logger } from "@/lib/logger";

type CustomerListItem = Prisma.CustomerGetPayload<{
  include: { _count: { select: { contracts: true } } };
}>;

export async function listCustomers(
  search: string,
  activeOnly: boolean,
  pagination: PaginationParams,
): Promise<PaginatedResult<CustomerListItem>> {
  const where: Prisma.CustomerWhereInput = {};
  if (activeOnly) where.isActive = true;
  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: "insensitive" } },
      { nationalId: { contains: search, mode: "insensitive" } },
      { code: { contains: search, mode: "insensitive" } },
      { phonePrimary: { contains: search, mode: "insensitive" } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { contracts: true } } },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
    prisma.customer.count({ where }),
  ]);

  return { data, total, page: pagination.page, pageSize: pagination.pageSize };
}

export async function createCustomer(data: CustomerCreateInput, createdById: number) {
  const existingNationalId = await prisma.customer.findUnique({
    where: { nationalId: data.nationalId },
  });
  if (existingNationalId) {
    throw new ServiceError("nationalIdAlreadyRegistered");
  }

  let phoneWarning: string | null = null;
  const phoneDup = await prisma.customer.findFirst({
    where: { phonePrimary: data.phonePrimary, isActive: true },
  });
  if (phoneDup) {
    phoneWarning = `تنبيه: رقم الهاتف مسجّل أيضاً لدى العميل ${phoneDup.fullName} (${phoneDup.code})`;
  }

  const customer = await prisma.$transaction(async (tx) => {
    const c = await tx.customer.create({
      data: {
        code: "__PENDING__",
        fullName: data.fullName,
        fatherName: data.fatherName,
        nationalId: data.nationalId,
        phonePrimary: data.phonePrimary,
        phoneSecondary: data.phoneSecondary || null,
        companyAddress: data.companyAddress,
        commercialRegistration: data.commercialRegistration || null,
        notes: data.notes || null,
        createdById,
      },
    });
    const code = `C-${String(c.id).padStart(4, "0")}`;
    const updated = await tx.customer.update({
      where: { id: c.id },
      data: { code },
    });

    await logAudit(tx, {
      userId: createdById,
      action: "create",
      entityType: "Customer",
      entityId: code,
      details: { fullName: data.fullName, nationalId: data.nationalId },
    });

    return updated;
  });

  logger.info({ customerId: customer.id, code: customer.code }, "customer created");
  return { customer, phoneWarning };
}

export async function getCustomerById(id: number) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      contracts: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!customer) throw new ServiceError("customerNotFound", "NOT_FOUND");
  return customer;
}

export async function updateCustomer(id: number, data: CustomerUpdateInput, updatedById: number) {
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) throw new ServiceError("customerNotFound", "NOT_FOUND");

  if (data.nationalId && data.nationalId !== existing.nationalId) {
    const dup = await prisma.customer.findUnique({
      where: { nationalId: data.nationalId },
    });
    if (dup && dup.id !== id) {
      throw new ServiceError("nationalIdAlreadyRegistered");
    }
  }

  const updatePayload = {
    ...(data.fullName !== undefined && { fullName: data.fullName }),
    ...(data.fatherName !== undefined && { fatherName: data.fatherName }),
    ...(data.nationalId !== undefined && { nationalId: data.nationalId }),
    ...(data.phonePrimary !== undefined && { phonePrimary: data.phonePrimary }),
    ...(data.phoneSecondary !== undefined && { phoneSecondary: data.phoneSecondary || null }),
    ...(data.companyAddress !== undefined && { companyAddress: data.companyAddress }),
    ...(data.commercialRegistration !== undefined && { commercialRegistration: data.commercialRegistration || null }),
    ...(data.notes !== undefined && { notes: data.notes || null }),
    updatedById,
  };

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.customer.update({ where: { id }, data: updatePayload });

    await logAudit(tx, {
      userId: updatedById,
      action: "update",
      entityType: "Customer",
      entityId: existing.code,
      details: JSON.parse(JSON.stringify(data)),
    });

    return result;
  });

  logger.info({ customerId: id, code: existing.code }, "customer updated");
  return updated;
}
