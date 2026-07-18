import type { OverrideType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { localizedPermission, localizedRole } from "@/lib/localized-name";
import { invalidateUserAuth } from "@/lib/permissions";
import {
  collectPermissionOverrideWarnings,
  getEditableModulesForActor,
  isReservedUnusedPermission,
  isSensitivePermission,
} from "@/lib/rbac-policy";
import { logAudit } from "./audit.service";
import { ServiceError } from "./errors";
import { logger } from "@/lib/logger";

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type PermissionSource = "role" | "grant" | "revoke";

export interface PermissionMatrixItem {
  code: string;
  displayName: string;
  module: string;
  inRoleDefault: boolean;
  override: OverrideType | null;
  effective: boolean;
  source: PermissionSource;
  sensitive: boolean;
  reservedUnused: boolean;
  editableByActor: boolean;
}

export interface UserPermissionMatrix {
  user: {
    id: number;
    username: string;
    fullName: string;
    roleCode: string;
    roleDisplayName: string;
    isActive: boolean;
  };
  readOnly: boolean;
  permissions: PermissionMatrixItem[];
  warnings: string[];
}

export interface PermissionToggleInput {
  code: string;
  enabled: boolean;
}

async function loadTargetUser(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      fullName: true,
      roleCode: true,
      isActive: true,
      role: { select: { displayName: true, displayNameEn: true } },
    },
  });
  if (!user || user.username === "system") {
    throw new ServiceError("userNotFound", "NOT_FOUND");
  }
  return user;
}

function assertCanMutateTarget(params: {
  targetUserId: number;
  targetRoleCode: string;
  actorId: number;
}) {
  if (params.targetRoleCode === "admin") {
    throw new ServiceError("superAdminPermissionsImmutable", "FORBIDDEN");
  }
  if (params.targetUserId === params.actorId) {
    throw new ServiceError("cannotEditOwnPermissions", "FORBIDDEN");
  }
}

function deriveOverride(
  inRoleDefault: boolean,
  enabled: boolean,
): OverrideType | null {
  if (inRoleDefault && enabled) return null;
  if (inRoleDefault && !enabled) return "revoke";
  if (!inRoleDefault && enabled) return "grant";
  return null;
}

function computeEffective(
  inRoleDefault: boolean,
  override: OverrideType | null,
): boolean {
  if (override === "grant") return true;
  if (override === "revoke") return false;
  return inRoleDefault;
}

function computeSource(
  inRoleDefault: boolean,
  override: OverrideType | null,
): PermissionSource {
  if (override === "grant") return "grant";
  if (override === "revoke") return "revoke";
  return "role";
}

function buildMatrixItem(params: {
  code: string;
  displayName: string;
  module: string;
  inRoleDefault: boolean;
  override: OverrideType | null;
  actorRoleCode: string;
  readOnly: boolean;
}): PermissionMatrixItem {
  const effective = params.readOnly
    ? true
    : computeEffective(params.inRoleDefault, params.override);
  const editableByActor =
    !params.readOnly &&
    (getEditableModulesForActor(params.actorRoleCode) === null ||
      getEditableModulesForActor(params.actorRoleCode)!.has(params.module));

  return {
    code: params.code,
    displayName: params.displayName,
    module: params.module,
    inRoleDefault: params.inRoleDefault,
    override: params.override,
    effective,
    source: params.readOnly ? "role" : computeSource(params.inRoleDefault, params.override),
    sensitive: isSensitivePermission(params.code),
    reservedUnused: isReservedUnusedPermission(params.code),
    editableByActor,
  };
}

export async function getUserPermissionMatrix(
  userId: number,
  actorRoleCode: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<UserPermissionMatrix> {
  const user = await loadTargetUser(userId);
  const catalog = await prisma.permission.findMany({
    orderBy: [{ module: "asc" }, { displayName: "asc" }],
    select: { code: true, displayName: true, displayNameEn: true, module: true },
  });

  const roleDisplayName = localizedRole(user.role, locale);

  const readOnly = user.roleCode === "admin";

  if (readOnly) {
    const permissions = catalog.map((p) =>
      buildMatrixItem({
        code: p.code,
        displayName: localizedPermission(p, locale),
        module: p.module,
        inRoleDefault: true,
        override: null,
        actorRoleCode,
        readOnly: true,
      }),
    );
    return {
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        roleCode: user.roleCode,
        roleDisplayName,
        isActive: user.isActive,
      },
      readOnly: true,
      permissions,
      warnings: [],
    };
  }

  const [roleDefaults, overrides] = await Promise.all([
    prisma.roleDefaultPermission.findMany({
      where: { roleCode: user.roleCode },
      select: { permissionCode: true },
    }),
    prisma.userPermissionOverride.findMany({
      where: { userId },
      select: { permissionCode: true, overrideType: true },
    }),
  ]);

  const defaultSet = new Set(roleDefaults.map((r) => r.permissionCode));
  const overrideMap = new Map(
    overrides.map((o) => [o.permissionCode, o.overrideType] as const),
  );

  const permissions = catalog.map((p) => {
    const inRoleDefault = defaultSet.has(p.code);
    const override = overrideMap.get(p.code) ?? null;
    return buildMatrixItem({
      code: p.code,
      displayName: localizedPermission(p, locale),
      module: p.module,
      inRoleDefault,
      override,
      actorRoleCode,
      readOnly: false,
    });
  });

  const effectiveEnabled = new Map(
    permissions.map((p) => [p.code, p.effective] as const),
  );

  return {
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      roleCode: user.roleCode,
      roleDisplayName,
      isActive: user.isActive,
    },
    readOnly: false,
    permissions,
    warnings: collectPermissionOverrideWarnings({
      targetRoleCode: user.roleCode,
      effectiveEnabled,
    }),
  };
}

async function applyOverrideDiff(
  tx: TxClient,
  userId: number,
  actorId: number,
  catalogByCode: Map<string, { module: string }>,
  roleDefaultSet: Set<string>,
  editableToggles: PermissionToggleInput[],
  actorEditableModules: ReadonlySet<string> | null,
) {
  const existing = await tx.userPermissionOverride.findMany({
    where: { userId },
    select: {
      permissionCode: true,
      overrideType: true,
      permission: { select: { module: true } },
    },
  });
  const existingMap = new Map(
    existing.map((o) => [o.permissionCode, o.overrideType] as const),
  );

  const desiredOverrides = new Map<string, OverrideType>();

  // Preserve overrides outside the actor's editable module scope.
  if (actorEditableModules !== null) {
    for (const o of existing) {
      if (!actorEditableModules.has(o.permission.module)) {
        desiredOverrides.set(o.permissionCode, o.overrideType);
      }
    }
  }

  for (const { code, enabled } of editableToggles) {
    const meta = catalogByCode.get(code);
    if (!meta) throw new ServiceError("unknownPermissionCode", "BAD_REQUEST", { code: code });
    const inRoleDefault = roleDefaultSet.has(code);
    const override = deriveOverride(inRoleDefault, enabled);
    if (override) desiredOverrides.set(code, override);
    else desiredOverrides.delete(code);
  }

  const toDelete: string[] = [];
  const toUpsert: { code: string; overrideType: OverrideType }[] = [];

  for (const [code, type] of desiredOverrides) {
    if (existingMap.get(code) !== type) {
      toUpsert.push({ code, overrideType: type });
    }
  }

  for (const code of existingMap.keys()) {
    if (!desiredOverrides.has(code)) toDelete.push(code);
  }

  if (toDelete.length > 0) {
    await tx.userPermissionOverride.deleteMany({
      where: { userId, permissionCode: { in: toDelete } },
    });
  }

  for (const { code, overrideType } of toUpsert) {
    await tx.userPermissionOverride.upsert({
      where: { userId_permissionCode: { userId, permissionCode: code } },
      create: {
        userId,
        permissionCode: code,
        overrideType,
        grantedById: actorId,
      },
      update: { overrideType, grantedById: actorId, grantedAt: new Date() },
    });
  }

  return {
    deleted: toDelete,
    upserted: toUpsert.map((u) => u.code),
  };
}

export async function setUserPermissionOverrides(
  userId: number,
  toggles: PermissionToggleInput[],
  actorId: number,
  actorRoleCode: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<UserPermissionMatrix> {
  const user = await loadTargetUser(userId);
  assertCanMutateTarget({
    targetUserId: userId,
    targetRoleCode: user.roleCode,
    actorId,
  });

  const catalog = await prisma.permission.findMany({
    select: { code: true, module: true },
  });
  const catalogByCode = new Map(catalog.map((p) => [p.code, p]));
  const catalogCodes = new Set(catalogByCode.keys());

  for (const { code } of toggles) {
    if (!catalogCodes.has(code)) {
      throw new ServiceError("unknownPermissionCode", "BAD_REQUEST", { code: code });
    }
  }

  const roleDefaults = await prisma.roleDefaultPermission.findMany({
    where: { roleCode: user.roleCode },
    select: { permissionCode: true },
  });
  const roleDefaultSet = new Set(roleDefaults.map((r) => r.permissionCode));

  const allowedModules = getEditableModulesForActor(actorRoleCode);
  const editableToggles =
    allowedModules === null
      ? toggles
      : toggles.filter((t) => {
          const meta = catalogByCode.get(t.code);
          return meta !== undefined && allowedModules.has(meta.module);
        });

  const changes = await prisma.$transaction(async (tx: TxClient) => {
    const diff = await applyOverrideDiff(
      tx,
      userId,
      actorId,
      catalogByCode,
      roleDefaultSet,
      editableToggles,
      allowedModules,
    );

    if (diff.deleted.length === 0 && diff.upserted.length === 0) {
      return diff;
    }

    await logAudit(tx, {
      userId: actorId,
      action: "update",
      entityType: "User",
      entityId: String(userId),
      details: {
        action: "permission_overrides",
        deletedOverrides: diff.deleted,
        upsertedOverrides: diff.upserted,
      } as Prisma.InputJsonValue,
    });

    return diff;
  });

  const hadChanges =
    changes.deleted.length > 0 || changes.upserted.length > 0;

  if (hadChanges) {
    invalidateUserAuth(userId);
    logger.info(
      { userId, actorId, changes },
      "user permission overrides updated",
    );
  }

  return getUserPermissionMatrix(userId, actorRoleCode, locale);
}

export async function resetUserPermissionOverrides(
  userId: number,
  actorId: number,
  actorRoleCode: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<UserPermissionMatrix> {
  const user = await loadTargetUser(userId);
  assertCanMutateTarget({
    targetUserId: userId,
    targetRoleCode: user.roleCode,
    actorId,
  });

  const allowedModules = getEditableModulesForActor(actorRoleCode);

  const deleted = await prisma.$transaction(async (tx: TxClient) => {
    const where: Prisma.UserPermissionOverrideWhereInput = { userId };
    if (allowedModules !== null) {
      where.permission = { module: { in: [...allowedModules] } };
    }

    const count = await tx.userPermissionOverride.count({ where });
    if (count === 0) return 0;

    await tx.userPermissionOverride.deleteMany({ where });

    await logAudit(tx, {
      userId: actorId,
      action: "update",
      entityType: "User",
      entityId: String(userId),
      details: {
        action: "permission_overrides_reset",
        removedCount: count,
        scopedToModules:
          allowedModules === null ? "all" : [...allowedModules],
      } as Prisma.InputJsonValue,
    });

    return count;
  });

  if (deleted > 0) {
    invalidateUserAuth(userId);
    logger.info(
      { userId, actorId, deleted },
      "user permission overrides reset",
    );
  }

  return getUserPermissionMatrix(userId, actorRoleCode, locale);
}

export async function copyUserPermissionOverrides(
  targetUserId: number,
  sourceUserId: number,
  actorId: number,
  actorRoleCode: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<UserPermissionMatrix> {
  if (targetUserId === sourceUserId) {
    throw new ServiceError("cannotCopyPermissionsFromSelf");
  }

  const [target, source] = await Promise.all([
    loadTargetUser(targetUserId),
    loadTargetUser(sourceUserId),
  ]);

  assertCanMutateTarget({
    targetUserId,
    targetRoleCode: target.roleCode,
    actorId,
  });

  if (source.roleCode === "admin") {
    throw new ServiceError("cannotCopyPermissionsFromSuperAdmin");
  }

  const sourceOverrides = await prisma.userPermissionOverride.findMany({
    where: { userId: sourceUserId },
    select: {
      permissionCode: true,
      overrideType: true,
      permission: { select: { module: true } },
    },
  });

  // Phase 1 isolation: non-admin actors silently copy only the overrides
  // belonging to modules they are allowed to edit; out-of-scope overrides
  // on the target are preserved.
  const allowedModules = getEditableModulesForActor(actorRoleCode);
  const scopedSourceOverrides =
    allowedModules === null
      ? sourceOverrides
      : sourceOverrides.filter((o) => allowedModules.has(o.permission.module));

  const deleteWhere: Prisma.UserPermissionOverrideWhereInput = {
    userId: targetUserId,
  };
  if (allowedModules !== null) {
    deleteWhere.permission = { module: { in: [...allowedModules] } };
  }

  await prisma.$transaction(async (tx: TxClient) => {
    await tx.userPermissionOverride.deleteMany({ where: deleteWhere });

    if (scopedSourceOverrides.length > 0) {
      await tx.userPermissionOverride.createMany({
        data: scopedSourceOverrides.map((o) => ({
          userId: targetUserId,
          permissionCode: o.permissionCode,
          overrideType: o.overrideType,
          grantedById: actorId,
        })),
      });
    }

    await logAudit(tx, {
      userId: actorId,
      action: "update",
      entityType: "User",
      entityId: String(targetUserId),
      details: {
        action: "permission_overrides_copied",
        sourceUserId,
        copiedCount: scopedSourceOverrides.length,
        scopedToModules:
          allowedModules === null ? "all" : [...allowedModules],
      } as Prisma.InputJsonValue,
    });
  });

  invalidateUserAuth(targetUserId);

  logger.info(
    {
      targetUserId,
      sourceUserId,
      actorId,
      count: scopedSourceOverrides.length,
    },
    "user permission overrides copied",
  );

  return getUserPermissionMatrix(targetUserId, actorRoleCode, locale);
}
