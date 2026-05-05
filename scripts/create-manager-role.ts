import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

/**
 * One-shot script to provision the "manager" (read-only owner) role and
 * a demo user without running the full demo seed (which would wipe data).
 *
 * Idempotent: re-running only re-asserts the role, permissions, and user
 * row; password is reset to MANAGER_PASSWORD only on first creation.
 */
const MANAGER_PASSWORD = "manager123";

const READ_ONLY_PERMISSIONS = [
  "dashboard.view",
  "contract.view",
  "salesorder.view",
  "truck.view_queue",
  "truck.view_approved",
  "payment.view",
  "reports.view",
  "report.daily_trucks",
  "report.customer_balance",
  "report.salesorder_status",
  "report.audit",
] as const;

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.role.upsert({
      where: { code: "manager" },
      update: { displayName: "صاحب المصنع (قراءة فقط)" },
      create: { code: "manager", displayName: "صاحب المصنع (قراءة فقط)" },
    });

    for (const code of READ_ONLY_PERMISSIONS) {
      await prisma.roleDefaultPermission.upsert({
        where: {
          roleCode_permissionCode: { roleCode: "manager", permissionCode: code },
        },
        update: {},
        create: { roleCode: "manager", permissionCode: code },
      });
    }
    await prisma.roleDefaultPermission.deleteMany({
      where: {
        roleCode: "manager",
        permissionCode: { notIn: [...READ_ONLY_PERMISSIONS] },
      },
    });

    const systemUser = await prisma.user.findUnique({
      where: { username: "system" },
      select: { id: true },
    });

    const passwordHash = await hash(MANAGER_PASSWORD, 10);
    const existing = await prisma.user.findUnique({
      where: { username: "manager" },
      select: { id: true },
    });

    const user = existing
      ? await prisma.user.update({
          where: { username: "manager" },
          data: {
            fullName: "صاحب المصنع",
            roleCode: "manager",
            isActive: true,
          },
          select: { id: true, username: true, fullName: true, roleCode: true },
        })
      : await prisma.user.create({
          data: {
            username: "manager",
            passwordHash,
            fullName: "صاحب المصنع",
            roleCode: "manager",
            isActive: true,
            createdById: systemUser?.id ?? null,
          },
          select: { id: true, username: true, fullName: true, roleCode: true },
        });

    const effective = await prisma.roleDefaultPermission.findMany({
      where: { roleCode: "manager" },
      select: { permissionCode: true },
      orderBy: { permissionCode: "asc" },
    });

    console.log(
      JSON.stringify(
        {
          user,
          passwordResetOnCreate: !existing,
          permissionCount: effective.length,
          permissions: effective.map((row) => row.permissionCode),
          containsAnyWritePermission: effective.some(
            (row) =>
              !row.permissionCode.endsWith(".view") &&
              !row.permissionCode.startsWith("report."),
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
