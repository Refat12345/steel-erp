import { prisma } from "@/lib/db";
import { logAudit } from "./audit.service";
import { ServiceError } from "./errors";
import { logger } from "@/lib/logger";
import { hash } from "bcryptjs";
import type { Prisma } from "@prisma/client";
import type { PaginationParams, PaginatedResult } from "@/lib/api-utils";
import { invalidateUserAuth } from "@/lib/permissions";

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const USER_SELECT = {
  id: true,
  username: true,
  fullName: true,
  roleCode: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { code: true, displayName: true, displayNameEn: true } },
  creator: { select: { id: true, fullName: true } },
} satisfies Prisma.UserSelect;

export type UserListItem = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export interface ListUsersFilters {
  roleCode?: string;
  isActive?: boolean;
  search?: string;
}

export async function listUsers(
  filters: ListUsersFilters,
  pagination: PaginationParams,
): Promise<PaginatedResult<UserListItem>> {
  const where: Prisma.UserWhereInput = {
    username: { not: "system" },
  };

  if (filters.roleCode) where.roleCode = filters.roleCode;
  if (filters.isActive !== undefined) where.isActive = filters.isActive;
  if (filters.search) {
    where.OR = [
      { username: { contains: filters.search, mode: "insensitive" } },
      { fullName: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return { data, total, page: pagination.page, pageSize: pagination.pageSize };
}

export async function getUserById(id: number) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: USER_SELECT,
  });
  if (!user || user.username === "system") {
    throw new ServiceError("userNotFound", "NOT_FOUND");
  }
  return user;
}

export interface CreateUserInput {
  username: string;
  fullName: string;
  password: string;
  roleCode: string;
}

export async function createUser(data: CreateUserInput, adminId: number) {
  const role = await prisma.role.findUnique({ where: { code: data.roleCode } });
  if (!role) throw new ServiceError("roleNotFound", "NOT_FOUND");

  const existing = await prisma.user.findUnique({ where: { username: data.username } });
  if (existing) throw new ServiceError("usernameAlreadyTaken");

  // Async bcrypt: offloads the CPU-bound hash to libuv's thread pool so the
  // Node.js event loop keeps serving other requests during admin onboarding.
  const passwordHash = await hash(data.password, 10);

  const user = await prisma.$transaction(async (tx: TxClient) => {
    const created = await tx.user.create({
      data: {
        username: data.username.toLowerCase().trim(),
        passwordHash,
        fullName: data.fullName.trim(),
        roleCode: data.roleCode,
        isActive: true,
        createdById: adminId,
      },
      select: USER_SELECT,
    });

    await logAudit(tx, {
      userId: adminId,
      action: "create",
      entityType: "User",
      entityId: String(created.id),
      details: {
        username: created.username,
        fullName: created.fullName,
        roleCode: created.roleCode,
      },
    });

    return created;
  });

  logger.info({ newUserId: user.id, username: user.username, by: adminId }, "user created");
  return user;
}

export interface UpdateUserInput {
  fullName?: string;
  roleCode?: string;
  isActive?: boolean;
}

export async function updateUser(id: number, data: UpdateUserInput, adminId: number) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || existing.username === "system") {
    throw new ServiceError("userNotFound", "NOT_FOUND");
  }

  if (data.roleCode) {
    const role = await prisma.role.findUnique({ where: { code: data.roleCode } });
    if (!role) throw new ServiceError("roleNotFound", "NOT_FOUND");
  }

  if (data.isActive === false && existing.roleCode === "admin") {
    const activeAdmins = await prisma.user.count({
      where: { roleCode: "admin", isActive: true, id: { not: id } },
    });
    if (activeAdmins === 0) {
      throw new ServiceError("cannotDisableLastActiveAdmin");
    }
  }

  const updateData: Prisma.UserUpdateInput = {};
  const changes: Record<string, unknown> = {};

  if (data.fullName !== undefined && data.fullName !== existing.fullName) {
    updateData.fullName = data.fullName.trim();
    changes.fullName = { from: existing.fullName, to: data.fullName.trim() };
  }
  if (data.roleCode !== undefined && data.roleCode !== existing.roleCode) {
    updateData.role = { connect: { code: data.roleCode } };
    changes.roleCode = { from: existing.roleCode, to: data.roleCode };
  }
  if (data.isActive !== undefined && data.isActive !== existing.isActive) {
    updateData.isActive = data.isActive;
    changes.isActive = { from: existing.isActive, to: data.isActive };
  }

  if (Object.keys(changes).length === 0) {
    return getUserById(id);
  }

  const user = await prisma.$transaction(async (tx: TxClient) => {
    const updated = await tx.user.update({
      where: { id },
      data: updateData,
      select: USER_SELECT,
    });

    await logAudit(tx, {
      userId: adminId,
      action: "update",
      entityType: "User",
      entityId: String(id),
      details: changes as Prisma.InputJsonValue,
    });

    return updated;
  });

  if ("roleCode" in changes || "isActive" in changes) {
    invalidateUserAuth(id);
  }

  logger.info({ userId: id, changes, by: adminId }, "user updated");
  return user;
}

export async function resetPassword(id: number, newPassword: string, adminId: number) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || existing.username === "system") {
    throw new ServiceError("userNotFound", "NOT_FOUND");
  }

  const passwordHash = await hash(newPassword, 10);

  await prisma.$transaction(async (tx: TxClient) => {
    await tx.user.update({
      where: { id },
      data: { passwordHash },
    });

    await logAudit(tx, {
      userId: adminId,
      action: "update",
      entityType: "User",
      entityId: String(id),
      details: { action: "password_reset" },
    });
  });

  logger.info({ userId: id, by: adminId }, "user password reset");
}

/**
 * Self-service UI language preference. Scope is strictly the caller's own
 * `locale` column — no other field, no other user.
 */
export async function updateOwnLocale(userId: number, locale: string) {
  await prisma.$transaction(async (tx: TxClient) => {
    await tx.user.update({
      where: { id: userId },
      data: { locale },
    });

    await logAudit(tx, {
      userId,
      action: "update",
      entityType: "User",
      entityId: String(userId),
      details: { action: "locale_change", locale },
    });
  });

  logger.info({ userId, locale }, "user locale updated");
}

export async function listRoles() {
  return prisma.role.findMany({
    orderBy: { code: "asc" },
    select: { code: true, displayName: true, displayNameEn: true },
  });
}
