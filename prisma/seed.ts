import { PrismaClient } from "@prisma/client";
import { hashSync } from "bcryptjs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const prisma = new PrismaClient();

/** National IDs reserved for re-runnable demo data (removed and recreated each seed). */
const DEMO_NATIONAL_IDS = [
  "DEMO-SEED-001",
  "DEMO-SEED-002",
  "DEMO-SEED-003",
  "DEMO-SEED-004",
  "DEMO-SEED-005",
] as const;

async function main() {
  console.log("Seeding database...");

  // ─── Roles ────────────────────────────────────────────────────
  const roles = [
    { code: "admin", displayName: "المدير العام" },
    { code: "finance", displayName: "المالية" },
    { code: "logistics", displayName: "اللوجستيك" },
    { code: "scale_operator", displayName: "عامل القبان" },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { displayName: role.displayName },
      create: role,
    });
  }
  console.log("  ✓ Roles seeded");

  // ─── Permissions ──────────────────────────────────────────────
  const permissions = [
    // Contracts
    { code: "contract.create", displayName: "إنشاء عقد", module: "contracts" },
    { code: "contract.edit", displayName: "تعديل عقد", module: "contracts" },
    { code: "contract.change_status", displayName: "تغيير حالة عقد", module: "contracts" },
    { code: "contract.view", displayName: "عرض العقود", module: "contracts" },
    // Sales Orders
    { code: "salesorder.create", displayName: "إنشاء أمر بيع", module: "sales" },
    { code: "salesorder.edit_draft", displayName: "تعديل مسودة أمر بيع", module: "sales" },
    { code: "salesorder.set_price", displayName: "تثبيت الأسعار", module: "sales" },
    { code: "salesorder.approve", displayName: "اعتماد أمر بيع", module: "sales" },
    { code: "salesorder.edit_approved", displayName: "تعديل بعد الاعتماد", module: "sales" },
    { code: "salesorder.cancel", displayName: "إلغاء أمر بيع", module: "sales" },
    { code: "salesorder.view", displayName: "عرض أوامر البيع", module: "sales" },
    // Trucks / Logistics
    { code: "truck.register", displayName: "تسجيل شاحنة", module: "logistics" },
    { code: "truck.edit_queued", displayName: "تعديل شاحنة بالطابور", module: "logistics" },
    { code: "truck.view_queue", displayName: "عرض الطابور", module: "logistics" },
    { code: "truck.view_approved", displayName: "عرض المعتمدة فقط", module: "logistics" },
    // Finance
    { code: "payment.create", displayName: "إدخال دفعة مالية", module: "finance" },
    { code: "payment.view", displayName: "عرض الدفعات", module: "finance" },
    { code: "creditlimit.set", displayName: "محجوز — غير مستخدم في v1", module: "finance" },
    { code: "buffer.grant", displayName: "منح Buffer", module: "finance" },
    { code: "specialratio.override", displayName: "موافقة تجاوز النسبة الخاصة", module: "finance" },
    // Scale
    { code: "scale.start", displayName: "بدء عملية وزن", module: "scale" },
    { code: "scale.enter_tare", displayName: "إدخال وزن الفارغ", module: "scale" },
    { code: "scale.enter_gross", displayName: "إدخال وزن المحمّل", module: "scale" },
    { code: "scale.enter_session", displayName: "إدخال وزنة داخلية", module: "scale" },
    { code: "scale.edit_session", displayName: "تعديل وزنة", module: "scale" },
    { code: "scale.upload_photo", displayName: "رفع صورة", module: "scale" },
    { code: "scale.close", displayName: "إغلاق عملية وطباعة كرت", module: "scale" },
    { code: "scale.cancel", displayName: "إلغاء عملية مع سبب", module: "scale" },
    // Admin
    { code: "forcepass.execute", displayName: "تمرير إجباري", module: "admin" },
    { code: "user.manage", displayName: "إدارة المستخدمين", module: "admin" },
    { code: "user.set_permissions", displayName: "تعديل صلاحيات المستخدمين", module: "admin" },
    { code: "settings.edit", displayName: "تعديل الإعدادات العامة", module: "admin" },
    // Reports
    { code: "report.daily_trucks", displayName: "تقرير شاحنات يومي", module: "reports" },
    { code: "report.customer_balance", displayName: "تقرير رصيد زبون", module: "reports" },
    { code: "report.salesorder_status", displayName: "تقرير حالة أمر بيع", module: "reports" },
    { code: "report.audit", displayName: "تقرير التدقيق", module: "reports" },
  ];

  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: { displayName: perm.displayName, module: perm.module },
      create: perm,
    });
  }
  console.log("  ✓ Permissions seeded");

  // ─── Role Default Permissions ─────────────────────────────────
  const rolePermissions: Record<string, string[]> = {
    finance: [
      "contract.view",
      "salesorder.view",
      "salesorder.set_price",
      "salesorder.approve",
      "salesorder.edit_approved",
      "truck.view_queue",
      "payment.create",
      "payment.view",
      "buffer.grant",
      "specialratio.override",
      "report.customer_balance",
      "report.salesorder_status",
      "report.audit",
    ],
    logistics: [
      "contract.create",
      "contract.edit",
      "contract.view",
      "salesorder.create",
      "salesorder.edit_draft",
      "salesorder.view",
      "truck.register",
      "truck.edit_queued",
      "truck.view_queue",
      "report.daily_trucks",
      "report.salesorder_status",
    ],
    scale_operator: [
      "contract.view",
      "salesorder.view",
      "truck.view_approved",
      "scale.start",
      "scale.enter_tare",
      "scale.enter_gross",
      "scale.enter_session",
      "scale.edit_session",
      "scale.upload_photo",
      "scale.close",
      "scale.cancel",
    ],
  };

  for (const [roleCode, permCodes] of Object.entries(rolePermissions)) {
    for (const permCode of permCodes) {
      await prisma.roleDefaultPermission.upsert({
        where: {
          roleCode_permissionCode: { roleCode, permissionCode: permCode },
        },
        update: {},
        create: { roleCode, permissionCode: permCode },
      });
    }
  }
  console.log("  ✓ Role-permission mappings seeded");

  // ─── Size Lookup ──────────────────────────────────────────────
  const sizes = [
    { code: "8mm", displayName: "8 مم", isSpecialRatio: true, subjectToTolerance: false, isBundleType: true, isActive: true, sortOrder: 1 },
    { code: "10mm", displayName: "10 مم", isSpecialRatio: true, subjectToTolerance: false, isBundleType: true, isActive: true, sortOrder: 2 },
    { code: "12mm", displayName: "12 مم", isSpecialRatio: false, subjectToTolerance: true, isBundleType: true, isActive: true, sortOrder: 3 },
    { code: "14mm", displayName: "14 مم", isSpecialRatio: false, subjectToTolerance: true, isBundleType: true, isActive: true, sortOrder: 4 },
    { code: "16mm", displayName: "16 مم", isSpecialRatio: false, subjectToTolerance: true, isBundleType: true, isActive: true, sortOrder: 5 },
    { code: "18mm", displayName: "18 مم", isSpecialRatio: false, subjectToTolerance: true, isBundleType: true, isActive: true, sortOrder: 6 },
    { code: "20mm", displayName: "20 مم", isSpecialRatio: false, subjectToTolerance: true, isBundleType: true, isActive: true, sortOrder: 7 },
    { code: "22mm", displayName: "22 مم", isSpecialRatio: false, subjectToTolerance: true, isBundleType: true, isActive: true, sortOrder: 8 },
    { code: "25mm", displayName: "25 مم", isSpecialRatio: false, subjectToTolerance: true, isBundleType: true, isActive: true, sortOrder: 9 },
    { code: "shortbar", displayName: "توالف (Shortbar)", isSpecialRatio: false, subjectToTolerance: true, isBundleType: false, isActive: true, sortOrder: 10 },
    { code: "6mm", displayName: "6 مم", isSpecialRatio: false, subjectToTolerance: true, isBundleType: true, isActive: false, sortOrder: 0 },
  ];

  for (const size of sizes) {
    await prisma.sizeLookup.upsert({
      where: { code: size.code },
      update: size,
      create: size,
    });
  }
  console.log("  ✓ Sizes seeded");

  // ─── System User (non-loginable, for FK references) ──────────
  const systemUser = await prisma.user.upsert({
    where: { username: "system" },
    update: {},
    create: {
      username: "system",
      passwordHash: "!nologin",
      fullName: "النظام",
      roleCode: "admin",
      isActive: false,
    },
  });
  console.log("  ✓ System user seeded");

  // ─── Default Admin User ───────────────────────────────────────
  const adminPassword = hashSync("admin123", 10);
  await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash: adminPassword,
      fullName: "المدير العام",
      roleCode: "admin",
      isActive: true,
      createdById: systemUser.id,
    },
  });
  console.log("  ✓ Admin user seeded (username: admin, password: admin123)");

  // ─── Demo customers & contracts (Slice 1 UI) ──────────────────
  const uploadsDir = path.join(process.cwd(), "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const seedAttachmentFileName = "seed-demo-contract.pdf";
  const seedAttachmentFullPath = path.join(uploadsDir, seedAttachmentFileName);
  const minimalPdf =
    "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n";
  await writeFile(seedAttachmentFullPath, minimalPdf, "utf8");
  const seedAttachmentPath = `uploads/${seedAttachmentFileName}`;

  const demoCustomers = await prisma.customer.findMany({
    where: { nationalId: { in: [...DEMO_NATIONAL_IDS] } },
    select: { id: true },
  });
  const demoCustomerIds = demoCustomers.map((c) => c.id);
  if (demoCustomerIds.length > 0) {
    const demoContracts = await prisma.masterContract.findMany({
      where: { customerId: { in: demoCustomerIds } },
      select: { contractNumber: true },
    });
    const demoContractNumbers = demoContracts.map((c) => c.contractNumber);
    if (demoContractNumbers.length > 0) {
      await prisma.contractAttachment.deleteMany({
        where: { contractNumber: { in: demoContractNumbers } },
      });
      await prisma.masterContract.deleteMany({
        where: { contractNumber: { in: demoContractNumbers } },
      });
    }
    await prisma.customer.deleteMany({
      where: { id: { in: demoCustomerIds } },
    });
  }

  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const prevYy = String(year - 1).slice(-2);

  const customersData = [
    {
      code: "C-DEMO-01",
      fullName: "أحمد محمد علي",
      fatherName: "محمد",
      nationalId: "DEMO-SEED-001",
      phonePrimary: "0933111001",
      phoneSecondary: "011-2345678",
      companyAddress: "دمشق — منطقة القابون، شارع الصناعة 12",
      commercialRegistration: "CR-10001",
      notes: "عميل تجريبي — نشط، عقد ساري.",
      isActive: true,
    },
    {
      code: "C-DEMO-02",
      fullName: "خالد يوسف الحسن",
      fatherName: "يوسف",
      nationalId: "DEMO-SEED-002",
      phonePrimary: "0944222002",
      phoneSecondary: null,
      companyAddress: "حلب — الصناعية، مجمع الحديد",
      commercialRegistration: null,
      notes: "عميل تجريبي — عقد حالي + عقد سابق مغلق.",
      isActive: true,
    },
    {
      code: "C-DEMO-03",
      fullName: "شركة البناء المتطور",
      fatherName: "فادي",
      nationalId: "DEMO-SEED-003",
      phonePrimary: "033-445566",
      phoneSecondary: "033-445577",
      companyAddress: "حمص — طريق الرستن",
      commercialRegistration: "CR-778899",
      notes: "عميل تجريبي — عقد معلّق لعرض الحالة في الواجهة.",
      isActive: true,
    },
    {
      code: "C-DEMO-04",
      fullName: "معن علي الدرويش",
      fatherName: "علي",
      nationalId: "DEMO-SEED-004",
      phonePrimary: "0955666777",
      phoneSecondary: null,
      companyAddress: "اللاذقية — الميناء",
      commercialRegistration: null,
      notes: "عميل تجريبي — عقد نشط.",
      isActive: true,
    },
    {
      code: "C-DEMO-05",
      fullName: "فاطمة زهرة أحمد",
      fatherName: "أحمد",
      nationalId: "DEMO-SEED-005",
      phonePrimary: "0966777888",
      phoneSecondary: null,
      companyAddress: "طرطوس — وسط المدينة",
      commercialRegistration: null,
      notes: "عميل تجريبي معطّل — لا يظهر في قائمة إنشاء عقد جديد (نشط فقط).",
      isActive: false,
    },
  ];

  const createdCustomers: { id: number; nationalId: string }[] = [];
  for (const c of customersData) {
    const row = await prisma.customer.create({
      data: {
        code: c.code,
        fullName: c.fullName,
        fatherName: c.fatherName,
        nationalId: c.nationalId,
        phonePrimary: c.phonePrimary,
        phoneSecondary: c.phoneSecondary,
        companyAddress: c.companyAddress,
        commercialRegistration: c.commercialRegistration,
        notes: c.notes,
        isActive: c.isActive,
        createdById: systemUser.id,
      },
    });
    createdCustomers.push({ id: row.id, nationalId: row.nationalId });
  }

  const byNid = (nid: string) =>
    createdCustomers.find((x) => x.nationalId === nid)!.id;

  // Use high CC (90+) so demo rows rarely collide with real YY-01, YY-02, … from the UI.
  const contractsSeed: Array<{
    contractNumber: string;
    customerNationalId: string;
    status: "active" | "suspended" | "closed";
    notes: string | null;
  }> = [
    {
      contractNumber: `${prevYy}-90`,
      customerNationalId: "DEMO-SEED-002",
      status: "closed",
      notes: "عقد سنة سابقة — مغلق (بيانات تجريبية).",
    },
    {
      contractNumber: `${yy}-90`,
      customerNationalId: "DEMO-SEED-001",
      status: "active",
      notes: "عقد بيع عام ساري — تجريبي.",
    },
    {
      contractNumber: `${yy}-91`,
      customerNationalId: "DEMO-SEED-002",
      status: "active",
      notes: "عقد السنة الحالية للعميل ذي العقد المغلق السابق.",
    },
    {
      contractNumber: `${yy}-92`,
      customerNationalId: "DEMO-SEED-003",
      status: "suspended",
      notes: "معلّق لاختبار عرض الحالة والأزرار.",
    },
    {
      contractNumber: `${yy}-93`,
      customerNationalId: "DEMO-SEED-004",
      status: "active",
      notes: "عقد نشط — عميل اللاذقية.",
    },
  ];

  for (const ct of contractsSeed) {
    const customerId = byNid(ct.customerNationalId);
    await prisma.masterContract.create({
      data: {
        contractNumber: ct.contractNumber,
        customerId,
        attachmentPath: seedAttachmentPath,
        status: ct.status,
        notes: ct.notes,
        createdById: systemUser.id,
      },
    });
    await prisma.contractAttachment.create({
      data: {
        contractNumber: ct.contractNumber,
        filePath: seedAttachmentPath,
        fileName: seedAttachmentFileName,
        fileSize: Buffer.byteLength(minimalPdf, "utf8"),
        uploadedById: systemUser.id,
      },
    });
  }

  console.log(
    `  ✓ Demo customers & contracts seeded (${customersData.length} customers, ${contractsSeed.length} contracts)`
  );

  console.log("\nSeeding complete!");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
