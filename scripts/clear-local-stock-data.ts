/**
 * LOCAL DEV ONLY — wipe finished-goods stock ledger so production-in / adjust
 * / transfer can be re-tested from a clean slate.
 *
 * Keeps yards + locations (structure). Clears:
 *   - all stock_movements (balances go to zero)
 *   - weigh_sessions.source_location_id / from_production (stock pick fields)
 *   - audit_log rows for StockMovement / stock_* events
 *
 * Refuses to run unless DATABASE_URL host is localhost / 127.0.0.1.
 *
 * Usage: npx tsx scripts/clear-local-stock-data.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const host = new URL(url).hostname;
if (host !== "localhost" && host !== "127.0.0.1") {
  console.error(`REFUSING: DATABASE_URL host is "${host}" — local only.`);
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.stockMovement.count();
  const weighLinked = await prisma.weighSession.count({
    where: { OR: [{ sourceLocationId: { not: null } }, { fromProduction: true }] },
  });

  const result = await prisma.$transaction(async (tx) => {
    const movements = await tx.stockMovement.deleteMany({});
    const weighs = await tx.weighSession.updateMany({
      where: { OR: [{ sourceLocationId: { not: null } }, { fromProduction: true }] },
      data: { sourceLocationId: null, fromProduction: false },
    });
    const audits = await tx.auditLog.deleteMany({
      where: {
        OR: [
          { entityType: "StockMovement" },
          { entityType: "StockLocation" },
          { entityType: "StockYard" },
        ],
      },
    });
    return { movements: movements.count, weighs: weighs.count, audits: audits.count };
  });

  console.log("Local stock data cleared:");
  console.log(`  stock_movements deleted: ${result.movements} (was ${before})`);
  console.log(`  weigh_sessions stock fields cleared: ${result.weighs} (linked ${weighLinked})`);
  console.log(`  stock-related audit_log rows deleted: ${result.audits}`);
  console.log("Yards/locations kept. Balances are now zero.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
