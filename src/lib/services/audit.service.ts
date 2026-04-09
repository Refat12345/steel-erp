import type { PrismaClient, Prisma, AuditAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { PaginationParams, PaginatedResult } from "@/lib/api-utils";

type TxClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export interface AuditEntry {
  userId: number;
  action: AuditAction;
  entityType: string;
  entityId: string;
  details?: Prisma.InputJsonValue;
}

/**
 * Write an audit log entry. Accepts either the global prisma client
 * or a transaction client (`tx`) so the log is atomic with the operation.
 */
export async function logAudit(client: TxClient, entry: AuditEntry) {
  await client.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      details: entry.details ?? undefined,
    },
  });
}

export type AuditLogListItem = Prisma.AuditLogGetPayload<{
  include: { user: { select: { id: true; username: true; fullName: true } } };
}>;

export interface AuditLogListFilters {
  userId?: number;
  action?: AuditAction;
  from?: Date;
  to?: Date;
}

export async function listAuditLogs(
  filters: AuditLogListFilters,
  pagination: PaginationParams,
): Promise<PaginatedResult<AuditLogListItem>> {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.userId != null) where.userId = filters.userId;
  if (filters.action != null) where.action = filters.action;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      include: {
        user: { select: { id: true, username: true, fullName: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    data,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

/** Active users for audit log filter dropdown (admin UI). */
export async function listUsersForAuditFilter() {
  return prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, username: true, fullName: true },
    orderBy: { username: "asc" },
    take: 500,
  });
}
