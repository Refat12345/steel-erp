/**
 * Full operational data wipe for demo resets. Deletes all business rows in FK-safe order.
 * Preserves: roles, permissions, role_default_permissions, permissions, size_lookup (reference data).
 *
 * Usage: npx tsx scripts/reset-full-db.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

export async function resetFullDatabase(client: PrismaClient): Promise<void> {
  // Single transaction: consistent empty state, fails fast on any constraint issue.
  await client.$transaction(async (tx) => {
    await tx.idempotencyKey.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.weighSession.deleteMany();
    await tx.truckPhoto.deleteMany();
    await tx.truckRequestItem.deleteMany();
    await tx.truckOperation.deleteMany();
    await tx.paymentAllocation.deleteMany();
    await tx.paymentSlice.deleteMany();
    await tx.orderItem.deleteMany();
    await tx.salesOrder.deleteMany();
    await tx.contractAttachment.deleteMany();
    await tx.masterContract.deleteMany();
    await tx.payment.deleteMany();
    await tx.customer.deleteMany();
    await tx.userPermissionOverride.deleteMany();
    await tx.user.deleteMany();
  });
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await resetFullDatabase(prisma);
    console.log("🧨 Database fully reset");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
