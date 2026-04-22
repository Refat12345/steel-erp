/**
 * Reset all demo user passwords for production deployment.
 * Usage: npx tsx scripts/reset-demo-passwords.ts <new-password>
 */
import { PrismaClient } from "@prisma/client";
import { hash as bcryptHash } from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_USERNAMES = ["admin", "finance", "logistics", "scale", "loader"];

async function main() {
  const newPassword = process.argv[2];
  if (!newPassword || newPassword.length < 8) {
    console.error("Usage: npx tsx scripts/reset-demo-passwords.ts <password>");
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const passwordHash = await bcryptHash(newPassword, 12);

  for (const username of DEMO_USERNAMES) {
    const result = await prisma.user.updateMany({
      where: { username },
      data: { passwordHash },
    });
    if (result.count > 0) {
      console.log(`  ✓ ${username} — password updated`);
    } else {
      console.log(`  - ${username} — not found (skipped)`);
    }
  }

  console.log("\nAll demo passwords have been reset.");
  console.log("IMPORTANT: Store the new password securely. Do not share it in plain text.");
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
