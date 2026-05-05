/**
 * مسح كامل لبيانات التشغيل وجميع المستخدمين، ثم إعادة تعبئة:
 * الأدوار، الصلاحيات، الأحجام المرجعية، مستخدم system (داخلي)، وحساب admin فقط.
 * مناسب للبدء من الصفر وإدخال البيانات يدوياً.
 *
 * Usage: npm run db:reset-admin
 */
import { execSync } from "node:child_process";

execSync("npx tsx scripts/reset-full-db.ts", {
  stdio: "inherit",
  cwd: process.cwd(),
});

execSync("npx tsx prisma/seed.ts", {
  stdio: "inherit",
  cwd: process.cwd(),
  env: { ...process.env, SEED_ADMIN_ONLY: "1" },
});
