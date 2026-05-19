import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  permission: {
    findMany: vi.fn(),
  },
  roleDefaultPermission: {
    findMany: vi.fn(),
  },
  userPermissionOverride: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({
  invalidateUserAuth: vi.fn(),
}));
vi.mock("./audit.service", () => ({
  logAudit: vi.fn(),
}));

import {
  getUserPermissionMatrix,
  setUserPermissionOverrides,
} from "./user-permission.service";

describe("user-permission.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUserPermissionMatrix", () => {
    it("returns read-only matrix for admin role", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 2,
        username: "gm",
        fullName: "GM",
        roleCode: "admin",
        isActive: true,
        role: { displayName: "المدير العام" },
      });
      mockPrisma.permission.findMany.mockResolvedValue([
        { code: "contract.view", displayName: "عرض", module: "contracts" },
        { code: "user.manage", displayName: "إدارة", module: "admin" },
      ]);

      const matrix = await getUserPermissionMatrix(2, "admin");

      expect(matrix.readOnly).toBe(true);
      expect(matrix.permissions.every((p) => p.effective)).toBe(true);
      expect(mockPrisma.roleDefaultPermission.findMany).not.toHaveBeenCalled();
    });

    it("computes grant and revoke sources for non-admin", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 3,
        username: "fin",
        fullName: "Finance",
        roleCode: "finance",
        isActive: true,
        role: { displayName: "المالية" },
      });
      mockPrisma.permission.findMany.mockResolvedValue([
        { code: "payment.view", displayName: "عرض دفعات", module: "finance" },
        { code: "buffer.grant", displayName: "منح", module: "finance" },
        { code: "truck.view_queue", displayName: "طابور", module: "logistics" },
      ]);
      mockPrisma.roleDefaultPermission.findMany.mockResolvedValue([
        { permissionCode: "payment.view" },
        { permissionCode: "buffer.grant" },
      ]);
      mockPrisma.userPermissionOverride.findMany.mockResolvedValue([
        { permissionCode: "buffer.grant", overrideType: "revoke" },
        { permissionCode: "truck.view_queue", overrideType: "grant" },
      ]);

      const matrix = await getUserPermissionMatrix(3, "admin");

      const payment = matrix.permissions.find((p) => p.code === "payment.view");
      const buffer = matrix.permissions.find((p) => p.code === "buffer.grant");
      const queue = matrix.permissions.find((p) => p.code === "truck.view_queue");

      expect(payment?.source).toBe("role");
      expect(payment?.effective).toBe(true);
      expect(buffer?.source).toBe("revoke");
      expect(buffer?.effective).toBe(false);
      expect(queue?.source).toBe("grant");
      expect(queue?.effective).toBe(true);
    });
  });

  describe("setUserPermissionOverrides", () => {
    it("rejects editing admin target", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        username: "gm",
        fullName: "GM",
        roleCode: "admin",
        isActive: true,
        role: { displayName: "المدير" },
      });

      await expect(
        setUserPermissionOverrides(
          1,
          [{ code: "payment.view", enabled: false }],
          99,
          "admin",
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining("ثابتة") });
    });

    it("rejects self-edit", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 5,
        username: "fin",
        fullName: "Finance",
        roleCode: "finance",
        isActive: true,
        role: { displayName: "المالية" },
      });

      await expect(
        setUserPermissionOverrides(
          5,
          [{ code: "payment.view", enabled: true }],
          5,
          "admin",
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining("صلاحياتك") });
    });
  });
});
