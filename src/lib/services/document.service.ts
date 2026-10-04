import { unlink } from "fs/promises";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { invalidateUserAuth } from "@/lib/permissions";
import type { PaginatedResult, PaginationParams } from "@/lib/api-utils";
import { logAudit } from "@/lib/services/audit.service";
import { ServiceError } from "@/lib/services/errors";
import { resolveStoredDocumentPath } from "@/lib/documents/stored-path";
import { sanitizeOriginalFileName } from "@/lib/documents/file-signature";

const DOCUMENT_VIEW = "document.view";
/** Root is level 1. A new folder under a level-8 folder is rejected. */
const MAX_FOLDER_DEPTH = 8;

export interface DocumentActor {
  userId: number;
  permissions: readonly string[];
}

export interface FolderListItem {
  id: number;
  name: string;
  nameEn: string | null;
  fileCount: number;
  folderCount: number;
  canUpload: boolean;
}

export interface FolderParent {
  id: number;
  name: string;
  nameEn: string | null;
}

export interface FolderDetail extends FolderListItem {
  canManage: boolean;
  /** Set only when this user can open the parent. Hidden parents are omitted. */
  parent: FolderParent | null;
}

export interface FolderMemberItem {
  userId: number;
  username: string;
  fullName: string;
  canUpload: boolean;
}

export interface DocumentListItem {
  id: number;
  title: string | null;
  notes: string | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
  uploadedById: number;
  uploaderName: string;
  canDelete: boolean;
}

export interface StoredDocumentFile {
  fullPath: string;
  fileName: string;
  mimeType: string;
}

type FolderAccess = { manage: boolean; canUpload: boolean };

function canManage(actor: DocumentActor): boolean {
  return actor.permissions.includes("document.manage");
}

function normalizeRequiredName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new ServiceError("documentFolderNameRequired");
  if (trimmed.length > 120) throw new ServiceError("documentFolderNameTooLong");
  return trimmed;
}

function normalizeOptionalName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  if (trimmed.length > 120) throw new ServiceError("documentFolderNameTooLong");
  return trimmed;
}

function normalizeOptionalText(
  value: string | null | undefined,
  max: number,
  tooLongKey: string,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new ServiceError(tooLongKey);
  return trimmed;
}

async function resolveFolderAccess(actor: DocumentActor, folderId: number): Promise<FolderAccess> {
  if (canManage(actor)) {
    const folder = await prisma.sharedFolder.findUnique({
      where: { id: folderId },
      select: { id: true },
    });
    if (!folder) throw new ServiceError("documentFolderNotFound", "NOT_FOUND");
    return { manage: true, canUpload: true };
  }

  const member = await prisma.folderMember.findUnique({
    where: { folderId_userId: { folderId, userId: actor.userId } },
    select: { canUpload: true, folder: { select: { id: true } } },
  });
  if (member) return { manage: false, canUpload: member.canUpload };

  const folder = await prisma.sharedFolder.findUnique({
    where: { id: folderId },
    select: { id: true },
  });
  if (!folder) throw new ServiceError("documentFolderNotFound", "NOT_FOUND");
  throw new ServiceError("forbidden", "FORBIDDEN");
}

type FolderRow = {
  id: number;
  parentId: number | null;
  name: string;
  nameEn: string | null;
  _count: { documents: number; children: number };
  members: { canUpload: boolean }[];
};

const folderListInclude = {
  _count: { select: { documents: true, children: true } },
  members: { select: { canUpload: true } },
} satisfies Prisma.SharedFolderInclude;

function toListItem(folder: FolderRow, manage: boolean, folderCount: number): FolderListItem {
  return {
    id: folder.id,
    name: folder.name,
    nameEn: folder.nameEn,
    fileCount: folder._count.documents,
    folderCount,
    canUpload: manage || folder.members[0]?.canUpload === true,
  };
}

/**
 * How many direct children this user can open.
 * Managers see every child. Members see only children they belong to,
 * so a hidden sibling folder is not revealed by the count.
 */
async function visibleChildCounts(
  actor: DocumentActor,
  folders: FolderRow[],
  manage: boolean,
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (folders.length === 0) return counts;
  if (manage) {
    for (const folder of folders) counts.set(folder.id, folder._count.children);
    return counts;
  }

  const children = await prisma.sharedFolder.findMany({
    where: {
      parentId: { in: folders.map((folder) => folder.id) },
      members: { some: { userId: actor.userId } },
    },
    select: { parentId: true },
  });
  for (const child of children) {
    if (child.parentId == null) continue;
    counts.set(child.parentId, (counts.get(child.parentId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Root shows a folder the user belongs to when its parent is not also
 * visible to them. Otherwise they reach it by opening the parent.
 * Managers only see true root folders here; they walk down from there.
 */
function rootEntriesForMember(folders: FolderRow[]): FolderRow[] {
  const visibleIds = new Set(folders.map((folder) => folder.id));
  return folders.filter(
    (folder) => folder.parentId == null || !visibleIds.has(folder.parentId),
  );
}

export async function listFolders(
  actor: DocumentActor,
  parentId: number | null = null,
): Promise<{
  canManage: boolean;
  folders: FolderListItem[];
}> {
  const manage = canManage(actor);

  if (parentId != null) {
    await resolveFolderAccess(actor, parentId);
  }

  const folders = await prisma.sharedFolder.findMany({
    where: manage
      ? { parentId }
      : parentId == null
        ? { members: { some: { userId: actor.userId } } }
        : { parentId, members: { some: { userId: actor.userId } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    include: {
      ...folderListInclude,
      members: { where: { userId: actor.userId }, select: { canUpload: true } },
    },
  });

  const visible = !manage && parentId == null ? rootEntriesForMember(folders) : folders;
  const childCounts = await visibleChildCounts(actor, visible, manage);

  return {
    canManage: manage,
    folders: visible.map((folder) => toListItem(folder, manage, childCounts.get(folder.id) ?? 0)),
  };
}

async function assertRoomUnderParent(parentId: number): Promise<void> {
  let currentId: number | null = parentId;
  let parentDepth = 0;
  const seen = new Set<number>();

  while (currentId != null) {
    if (seen.has(currentId)) throw new ServiceError("documentFolderNotFound", "NOT_FOUND");
    seen.add(currentId);
    parentDepth += 1;
    if (parentDepth >= MAX_FOLDER_DEPTH) {
      throw new ServiceError("documentFolderTooDeep", "CONFLICT");
    }
    const row: { parentId: number | null } | null = await prisma.sharedFolder.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    if (!row) throw new ServiceError("documentFolderNotFound", "NOT_FOUND");
    currentId = row.parentId;
  }
}

export async function getFolder(actor: DocumentActor, folderId: number): Promise<FolderDetail> {
  const access = await resolveFolderAccess(actor, folderId);
  const folder = await prisma.sharedFolder.findUnique({
    where: { id: folderId },
    include: {
      _count: { select: { documents: true, children: true } },
      members: {
        where: { userId: actor.userId },
        select: { canUpload: true },
      },
      parent: {
        select: {
          id: true,
          name: true,
          nameEn: true,
          members: {
            where: { userId: actor.userId },
            select: { userId: true },
          },
        },
      },
    },
  });
  if (!folder) throw new ServiceError("documentFolderNotFound", "NOT_FOUND");

  const folderCount = access.manage
    ? folder._count.children
    : await prisma.sharedFolder.count({
        where: { parentId: folderId, members: { some: { userId: actor.userId } } },
      });
  const parent =
    folder.parent && (access.manage || folder.parent.members.length > 0)
      ? { id: folder.parent.id, name: folder.parent.name, nameEn: folder.parent.nameEn }
      : null;

  return { ...toListItem(folder, access.manage, folderCount), canManage: access.manage, parent };
}

export async function createFolder(
  actor: DocumentActor,
  input: { name: string; nameEn?: string | null; parentId?: number | null },
): Promise<FolderListItem> {
  if (!canManage(actor)) throw new ServiceError("forbidden", "FORBIDDEN");
  const name = normalizeRequiredName(input.name);
  const nameEn = normalizeOptionalName(input.nameEn);
  const parentId = input.parentId ?? null;
  if (parentId != null) await assertRoomUnderParent(parentId);

  const folder = await prisma.$transaction(async (tx) => {
    if (parentId != null) {
      const parent = await tx.sharedFolder.findUnique({
        where: { id: parentId },
        select: { id: true },
      });
      if (!parent) throw new ServiceError("documentFolderNotFound", "NOT_FOUND");
    }

    const created = await tx.sharedFolder.create({
      data: { name, nameEn, parentId, createdById: actor.userId },
      include: {
        _count: { select: { documents: true, children: true } },
        members: { where: { userId: actor.userId }, select: { canUpload: true } },
      },
    });
    await logAudit(tx, {
      userId: actor.userId,
      action: "create",
      entityType: "shared_folder",
      entityId: String(created.id),
      details: { name, nameEn, parentId },
    });
    return created;
  });

  return toListItem(folder, true, 0);
}

export async function updateFolder(
  actor: DocumentActor,
  folderId: number,
  input: { name: string; nameEn?: string | null },
): Promise<FolderListItem> {
  if (!canManage(actor)) throw new ServiceError("forbidden", "FORBIDDEN");
  const name = normalizeRequiredName(input.name);
  const nameEn = normalizeOptionalName(input.nameEn);

  const folder = await prisma.$transaction(async (tx) => {
    const existing = await tx.sharedFolder.findUnique({
      where: { id: folderId },
      select: { id: true },
    });
    if (!existing) throw new ServiceError("documentFolderNotFound", "NOT_FOUND");

    const updated = await tx.sharedFolder.update({
      where: { id: folderId },
      data: { name, nameEn },
      include: {
        _count: { select: { documents: true, children: true } },
        members: { where: { userId: actor.userId }, select: { canUpload: true } },
      },
    });
    await logAudit(tx, {
      userId: actor.userId,
      action: "update",
      entityType: "shared_folder",
      entityId: String(folderId),
      details: { name, nameEn },
    });
    return updated;
  });

  return toListItem(folder, true, folder._count.children);
}

export async function deleteFolder(actor: DocumentActor, folderId: number): Promise<void> {
  if (!canManage(actor)) throw new ServiceError("forbidden", "FORBIDDEN");

  await prisma.$transaction(async (tx) => {
    const existing = await tx.sharedFolder.findUnique({
      where: { id: folderId },
      select: { id: true, _count: { select: { documents: true, children: true } } },
    });
    if (!existing) throw new ServiceError("documentFolderNotFound", "NOT_FOUND");
    if (existing._count.documents > 0 || existing._count.children > 0) {
      throw new ServiceError("documentFolderNotEmpty", "CONFLICT");
    }
    await tx.sharedFolder.delete({ where: { id: folderId } });
    await logAudit(tx, {
      userId: actor.userId,
      action: "delete",
      entityType: "shared_folder",
      entityId: String(folderId),
    });
  });
}

export async function listFolderMembers(
  actor: DocumentActor,
  folderId: number,
): Promise<FolderMemberItem[]> {
  if (!canManage(actor)) throw new ServiceError("forbidden", "FORBIDDEN");
  const folder = await prisma.sharedFolder.findUnique({
    where: { id: folderId },
    select: { id: true },
  });
  if (!folder) throw new ServiceError("documentFolderNotFound", "NOT_FOUND");

  const members = await prisma.folderMember.findMany({
    where: { folderId },
    orderBy: { user: { fullName: "asc" } },
    select: {
      userId: true,
      canUpload: true,
      user: { select: { username: true, fullName: true } },
    },
  });

  return members.map((member) => ({
    userId: member.userId,
    username: member.user.username,
    fullName: member.user.fullName,
    canUpload: member.canUpload,
  }));
}

/**
 * Members need `document.view` to reach the module. An existing override is
 * never changed: an admin's explicit revoke must win over folder membership.
 */
async function grantDocumentViewWhereMissing(
  tx: Prisma.TransactionClient,
  userIds: number[],
  actorId: number,
): Promise<number[]> {
  if (userIds.length === 0) return [];
  const existing = await tx.userPermissionOverride.findMany({
    where: { userId: { in: userIds }, permissionCode: DOCUMENT_VIEW },
    select: { userId: true },
  });
  const withOverride = new Set(existing.map((row) => row.userId));
  const missing = userIds.filter((userId) => !withOverride.has(userId));
  if (missing.length === 0) return [];

  await tx.userPermissionOverride.createMany({
    data: missing.map((userId) => ({
      userId,
      permissionCode: DOCUMENT_VIEW,
      overrideType: "grant" as const,
      grantedById: actorId,
    })),
    skipDuplicates: true,
  });
  return missing;
}

export async function setFolderMembers(
  actor: DocumentActor,
  folderId: number,
  members: { userId: number; canUpload: boolean }[],
): Promise<FolderMemberItem[]> {
  if (!canManage(actor)) throw new ServiceError("forbidden", "FORBIDDEN");

  const desired = new Map<number, boolean>();
  for (const member of members) {
    if (!Number.isInteger(member.userId) || member.userId <= 0) {
      throw new ServiceError("invalidData");
    }
    desired.set(member.userId, member.canUpload);
  }
  const userIds = [...desired.keys()];

  if (userIds.length > 0) {
    const eligible = await prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true, username: { not: "system" } },
      select: { id: true },
    });
    if (eligible.length !== userIds.length) {
      throw new ServiceError("documentUserNotEligible");
    }
  }

  const touchedUserIds = await prisma.$transaction(async (tx) => {
    const folder = await tx.sharedFolder.findUnique({
      where: { id: folderId },
      select: { id: true },
    });
    if (!folder) throw new ServiceError("documentFolderNotFound", "NOT_FOUND");

    const current = await tx.folderMember.findMany({
      where: { folderId },
      select: { userId: true },
    });
    const currentUserIds = new Set(current.map((member) => member.userId));
    const removedUserIds = current
      .map((member) => member.userId)
      .filter((userId) => !desired.has(userId));

    const addedUserIds = userIds.filter((userId) => !currentUserIds.has(userId));
    if (addedUserIds.length > 0) {
      const revoked = await tx.userPermissionOverride.findFirst({
        where: {
          userId: { in: addedUserIds },
          permissionCode: DOCUMENT_VIEW,
          overrideType: "revoke",
        },
        select: { userId: true },
      });
      if (revoked) throw new ServiceError("documentUserAccessRevoked", "CONFLICT");
    }

    if (removedUserIds.length > 0) {
      await tx.folderMember.deleteMany({
        where: { folderId, userId: { in: removedUserIds } },
      });
    }

    for (const [userId, memberCanUpload] of desired) {
      await tx.folderMember.upsert({
        where: { folderId_userId: { folderId, userId } },
        create: {
          folderId,
          userId,
          canUpload: memberCanUpload,
          grantedById: actor.userId,
        },
        update: {
          canUpload: memberCanUpload,
          grantedById: actor.userId,
          grantedAt: new Date(),
        },
      });
    }

    const grantedViewUserIds = await grantDocumentViewWhereMissing(tx, userIds, actor.userId);

    await logAudit(tx, {
      userId: actor.userId,
      action: "update",
      entityType: "shared_folder",
      entityId: String(folderId),
      details: {
        members: [...desired.entries()].map(([userId, memberCanUpload]) => ({
          userId,
          canUpload: memberCanUpload,
        })),
        removedUserIds,
        grantedViewUserIds,
      },
    });
    for (const userId of grantedViewUserIds) {
      await logAudit(tx, {
        userId: actor.userId,
        action: "update",
        entityType: "User",
        entityId: String(userId),
        details: {
          action: "permission_overrides",
          deletedOverrides: [],
          upsertedOverrides: [DOCUMENT_VIEW],
          reason: "shared_folder_member",
          folderId,
        },
      });
    }

    return [...new Set([...current.map((member) => member.userId), ...userIds])];
  });

  for (const userId of touchedUserIds) invalidateUserAuth(userId);
  return listFolderMembers(actor, folderId);
}

export async function searchDocumentUsers(actor: DocumentActor, search: string) {
  if (!canManage(actor)) throw new ServiceError("forbidden", "FORBIDDEN");
  const query = search.trim();
  if (query.length < 1) return [];

  return prisma.user.findMany({
    where: {
      isActive: true,
      username: { not: "system" },
      OR: [
        { username: { contains: query, mode: "insensitive" } },
        { fullName: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true, username: true, fullName: true },
    orderBy: { fullName: "asc" },
    take: 20,
  });
}

export async function assertCanUpload(actor: DocumentActor, folderId: number): Promise<void> {
  const access = await resolveFolderAccess(actor, folderId);
  if (!access.canUpload) throw new ServiceError("forbidden", "FORBIDDEN");
}

export async function listFolderFiles(
  actor: DocumentActor,
  folderId: number,
  search: string,
  pagination: PaginationParams,
): Promise<PaginatedResult<DocumentListItem> & { canUpload: boolean; canManage: boolean }> {
  const access = await resolveFolderAccess(actor, folderId);
  const query = search.trim();
  const where: Prisma.SharedDocumentWhereInput = {
    folderId,
    ...(query
      ? {
          OR: [
            { fileName: { contains: query, mode: "insensitive" } },
            { title: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.sharedDocument.findMany({
      where,
      orderBy: { uploadedAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: {
        id: true,
        title: true,
        notes: true,
        fileName: true,
        fileSize: true,
        mimeType: true,
        uploadedAt: true,
        uploadedById: true,
        uploader: { select: { fullName: true } },
      },
    }),
    prisma.sharedDocument.count({ where }),
  ]);

  return {
    data: rows.map((row) => ({
      id: row.id,
      title: row.title,
      notes: row.notes,
      fileName: row.fileName,
      fileSize: row.fileSize,
      mimeType: row.mimeType,
      uploadedAt: row.uploadedAt,
      uploadedById: row.uploadedById,
      uploaderName: row.uploader.fullName,
      canDelete: access.manage || (access.canUpload && row.uploadedById === actor.userId),
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    canUpload: access.canUpload,
    canManage: access.manage,
  };
}

export async function createSharedDocument(
  actor: DocumentActor,
  folderId: number,
  file: { filePath: string; fileName: string; fileSize: number; mimeType: string },
  meta: { title?: string | null; notes?: string | null },
) {
  await assertCanUpload(actor, folderId);
  const stored = resolveStoredDocumentPath(file.filePath, folderId);
  if (!stored) throw new ServiceError("invalidPath");

  const title = normalizeOptionalText(meta.title, 200, "documentTitleTooLong");
  const notes = normalizeOptionalText(meta.notes, 2000, "documentNotesTooLong");
  const fileName = sanitizeOriginalFileName(file.fileName);

  return prisma.$transaction(async (tx) => {
    const folder = await tx.sharedFolder.findUnique({
      where: { id: folderId },
      select: { id: true },
    });
    if (!folder) throw new ServiceError("documentFolderNotFound", "NOT_FOUND");

    const created = await tx.sharedDocument.create({
      data: {
        folderId,
        title,
        notes,
        filePath: file.filePath,
        fileName,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        uploadedById: actor.userId,
      },
      select: { id: true, fileName: true, fileSize: true, title: true },
    });
    await logAudit(tx, {
      userId: actor.userId,
      action: "upload",
      entityType: "shared_document",
      entityId: String(created.id),
      details: { folderId, fileName, fileSize: file.fileSize },
    });
    return created;
  });
}

async function loadAccessibleDocument(actor: DocumentActor, documentId: number) {
  const document = await prisma.sharedDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      folderId: true,
      filePath: true,
      fileName: true,
      mimeType: true,
      uploadedById: true,
    },
  });
  if (!document) throw new ServiceError("documentFileNotFound", "NOT_FOUND");

  let access: FolderAccess;
  try {
    access = await resolveFolderAccess(actor, document.folderId);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "FORBIDDEN") {
      throw new ServiceError("documentFileNotFound", "NOT_FOUND");
    }
    throw error;
  }
  return { document, access };
}

export async function getSharedDocumentFile(
  actor: DocumentActor,
  documentId: number,
): Promise<StoredDocumentFile> {
  const { document } = await loadAccessibleDocument(actor, documentId);
  const fullPath = resolveStoredDocumentPath(document.filePath, document.folderId);
  if (!fullPath) throw new ServiceError("documentFileNotFound", "NOT_FOUND");
  return { fullPath, fileName: document.fileName, mimeType: document.mimeType };
}

export async function deleteSharedDocument(actor: DocumentActor, documentId: number): Promise<void> {
  const { document, access } = await loadAccessibleDocument(actor, documentId);
  const ownsFile = access.canUpload && document.uploadedById === actor.userId;
  if (!access.manage && !ownsFile) throw new ServiceError("forbidden", "FORBIDDEN");

  await prisma.$transaction(async (tx) => {
    await tx.sharedDocument.delete({ where: { id: document.id } });
    await logAudit(tx, {
      userId: actor.userId,
      action: "delete",
      entityType: "shared_document",
      entityId: String(document.id),
      details: { folderId: document.folderId, fileName: document.fileName },
    });
  });

  const fullPath = resolveStoredDocumentPath(document.filePath, document.folderId);
  if (!fullPath) return;
  try {
    await unlink(fullPath);
  } catch (error) {
    logger.error({ err: error, documentId: document.id }, "shared document file unlink failed");
  }
}
