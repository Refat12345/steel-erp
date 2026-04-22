/**
 * مسح كل بيانات التشغيل وإعادة تعبئة RBAC + admin فقط.
 * Usage: npm run db:reset-admin
 */
import { execSync } from "node:child_process";

execSync("npx tsx prisma/seed.ts", {
  stdio: "inherit",
  env: { ...process.env, SEED_ADMIN_ONLY: "1" },
  cwd: process.cwd(),
});
