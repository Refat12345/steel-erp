import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  sharedFolder: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  folderMember: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  },
  user: { findMany: vi.fn() },
  userPermissionOverride: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({ invalidateUserAuth: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("./audit.service", () => ({ logAudit: vi.fn() }));

import { invalidateUserAuth } from "@/lib/permissions";
import { logAudit } from "./audit.service";
import { createFolder, deleteFolder, listFolders, setFolderMembers } from "./document.service";

describe("document.service access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma));
  });

  it("lists only folders the user belongs to", async () => {
    mockPrisma.sharedFolder.findMany.mockResolvedValue([]);
    await listFolders({ userId: 4, permissions: ["document.view"] });
    expect(mockPrisma.sharedFolder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { members: { some: { userId: 4 } } },
      }),
    );
  });

  function row(
    id: number,
    parentId: number | null,
    children = 0,
  ) {
    return {
      id,
      parentId,
      name: `Folder ${id}`,
      nameEn: null,
      _count: { documents: 0, children },
      members: [{ canUpload: false }],
    };
  }

  it("lists every root folder for a manager", async () => {
    mockPrisma.sharedFolder.findMany.mockResolvedValue([]);
    const result = await listFolders({ userId: 1, permissions: ["document.manage"] });
    expect(result.canManage).toBe(true);
    expect(mockPrisma.sharedFolder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { parentId: null } }),
    );
  });

  it("hides a child folder when the user can already open its parent", async () => {
    mockPrisma.sharedFolder.findMany
      .mockResolvedValueOnce([row(1, null, 1), row(2, 1)])
      .mockResolvedValueOnce([{ parentId: 1 }]);

    const result = await listFolders({ userId: 4, permissions: ["document.view"] });

    expect(result.folders.map((folder) => folder.id)).toEqual([1]);
    expect(result.folders[0]?.folderCount).toBe(1);
  });

  it("shows a nested folder at the root when the user cannot open its parent", async () => {
    mockPrisma.sharedFolder.findMany
      .mockResolvedValueOnce([row(2, 1)])
      .mockResolvedValueOnce([]);

    const result = await listFolders({ userId: 4, permissions: ["document.view"] });

    expect(result.folders.map((folder) => folder.id)).toEqual([2]);
  });

  it("lists only child folders the user belongs to", async () => {
    mockPrisma.folderMember.findUnique.mockResolvedValue({
      canUpload: false,
      folder: { id: 1 },
    });
    mockPrisma.sharedFolder.findMany.mockResolvedValue([]);

    await listFolders({ userId: 4, permissions: ["document.view"] }, 1);

    expect(mockPrisma.sharedFolder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { parentId: 1, members: { some: { userId: 4 } } },
      }),
    );
  });

  it("refuses to delete a folder that still has files", async () => {
    mockPrisma.sharedFolder.findUnique.mockResolvedValue({
      id: 3,
      _count: { documents: 2 },
    });
    await expect(
      deleteFolder({ userId: 1, permissions: ["document.manage"] }, 3),
    ).rejects.toMatchObject({ messageKey: "documentFolderNotEmpty", code: "CONFLICT" });
    expect(mockPrisma.sharedFolder.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete a folder that still has an inner folder", async () => {
    mockPrisma.sharedFolder.findUnique.mockResolvedValue({
      id: 3,
      _count: { documents: 0, children: 1 },
    });
    await expect(
      deleteFolder({ userId: 1, permissions: ["document.manage"] }, 3),
    ).rejects.toMatchObject({ messageKey: "documentFolderNotEmpty", code: "CONFLICT" });
    expect(mockPrisma.sharedFolder.delete).not.toHaveBeenCalled();
  });

  it("refuses to nest folders deeper than 8 levels", async () => {
    let nextParent = 10;
    mockPrisma.sharedFolder.findUnique.mockImplementation(async () => {
      nextParent += 1;
      return { parentId: nextParent };
    });

    await expect(
      createFolder({ userId: 1, permissions: ["document.manage"] }, { name: "Deep", parentId: 9 }),
    ).rejects.toMatchObject({ messageKey: "documentFolderTooDeep", code: "CONFLICT" });
    expect(mockPrisma.sharedFolder.create).not.toHaveBeenCalled();
  });

  it("grants document.view when a member without an override is added", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: 8 }]);
    mockPrisma.sharedFolder.findUnique.mockResolvedValue({ id: 2 });
    mockPrisma.userPermissionOverride.findFirst.mockResolvedValue(null);
    mockPrisma.userPermissionOverride.findMany.mockResolvedValue([]);
    mockPrisma.folderMember.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { userId: 8, canUpload: true, user: { username: "lab", fullName: "Lab" } },
      ]);

    await setFolderMembers({ userId: 1, permissions: ["document.manage"] }, 2, [
      { userId: 8, canUpload: true },
    ]);

    expect(mockPrisma.userPermissionOverride.createMany).toHaveBeenCalledWith({
      data: [{ userId: 8, permissionCode: "document.view", overrideType: "grant", grantedById: 1 }],
      skipDuplicates: true,
    });
    expect(logAudit).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ entityType: "User", entityId: "8" }),
    );
    expect(invalidateUserAuth).toHaveBeenCalledWith(8);
  });

  it("refuses to add a user whose document.view was revoked", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: 8 }]);
    mockPrisma.sharedFolder.findUnique.mockResolvedValue({ id: 2 });
    mockPrisma.folderMember.findMany.mockResolvedValueOnce([]);
    mockPrisma.userPermissionOverride.findFirst.mockResolvedValue({ userId: 8 });

    await expect(
      setFolderMembers({ userId: 1, permissions: ["document.manage"] }, 2, [
        { userId: 8, canUpload: false },
      ]),
    ).rejects.toMatchObject({ messageKey: "documentUserAccessRevoked", code: "CONFLICT" });
    expect(mockPrisma.folderMember.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.userPermissionOverride.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.userPermissionOverride.upsert).not.toHaveBeenCalled();
  });

  it("never overwrites an existing override for a current member", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: 8 }]);
    mockPrisma.sharedFolder.findUnique.mockResolvedValue({ id: 2 });
    mockPrisma.userPermissionOverride.findMany.mockResolvedValue([{ userId: 8 }]);
    mockPrisma.folderMember.findMany
      .mockResolvedValueOnce([{ userId: 8 }])
      .mockResolvedValueOnce([
        { userId: 8, canUpload: false, user: { username: "lab", fullName: "Lab" } },
      ]);

    await setFolderMembers({ userId: 1, permissions: ["document.manage"] }, 2, [
      { userId: 8, canUpload: false },
    ]);

    expect(mockPrisma.userPermissionOverride.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.userPermissionOverride.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.userPermissionOverride.upsert).not.toHaveBeenCalled();
  });
});
