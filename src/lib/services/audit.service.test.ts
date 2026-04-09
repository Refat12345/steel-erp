import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  auditLog: {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { listAuditLogs, listUsersForAuditFilter, logAudit } from "./audit.service";

describe("audit.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("logAudit", () => {
    it("creates an audit log entry with the correct data", async () => {
      mockPrisma.auditLog.create.mockResolvedValue({ id: 1 });

      await logAudit(mockPrisma as any, {
        userId: 5,
        action: "create",
        entityType: "Customer",
        entityId: "C-0001",
        details: { fullName: "Test" },
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 5,
          action: "create",
          entityType: "Customer",
          entityId: "C-0001",
          details: { fullName: "Test" },
        },
      });
    });

    it("passes undefined details when not provided", async () => {
      mockPrisma.auditLog.create.mockResolvedValue({ id: 2 });

      await logAudit(mockPrisma as any, {
        userId: 1,
        action: "update",
        entityType: "MasterContract",
        entityId: "26-01",
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ details: undefined }),
      });
    });
  });

  describe("listAuditLogs", () => {
    it("returns paginated audit logs without filters", async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      mockPrisma.auditLog.count.mockResolvedValue(2);

      const result = await listAuditLogs({}, { page: 1, pageSize: 25 });

      expect(result).toEqual({
        data: [{ id: 1 }, { id: 2 }],
        total: 2,
        page: 1,
        pageSize: 25,
      });
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          orderBy: { createdAt: "desc" },
          skip: 0,
          take: 25,
        }),
      );
    });

    it("applies action and user filters", async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      await listAuditLogs(
        { userId: 7, action: "status_change" },
        { page: 2, pageSize: 10 },
      );

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 7, action: "status_change" },
          skip: 10,
          take: 10,
        }),
      );
      expect(mockPrisma.auditLog.count).toHaveBeenCalledWith({
        where: { userId: 7, action: "status_change" },
      });
    });

    it("applies createdAt date-range filter", async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      const from = new Date("2026-04-01T00:00:00.000Z");
      const to = new Date("2026-04-10T23:59:59.999Z");

      await listAuditLogs({ from, to }, { page: 1, pageSize: 25 });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            createdAt: {
              gte: from,
              lte: to,
            },
          },
        }),
      );
      expect(mockPrisma.auditLog.count).toHaveBeenCalledWith({
        where: {
          createdAt: {
            gte: from,
            lte: to,
          },
        },
      });
    });
  });

  describe("listUsersForAuditFilter", () => {
    it("returns active users for filter dropdown", async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 1, username: "admin", fullName: "المدير العام" },
      ]);

      const users = await listUsersForAuditFilter();

      expect(users).toHaveLength(1);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        select: { id: true, username: true, fullName: true },
        orderBy: { username: "asc" },
        take: 500,
      });
    });
  });
});
