import { PrismaClient, type SettlementMode } from "@prisma/client";
import { hash } from "bcryptjs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
  RBAC_PERMISSIONS,
  RBAC_ROLE_PERMISSIONS,
  RBAC_ROLES,
} from "./rbac-source";

const prisma = new PrismaClient();

/**
 * When set (`1` or `true`), seed wipes all operational data then re-applies
 * RBAC + sizes + system user + admin only — no demo customers/contracts/SOs.
 * Use after full DB wipe via `npm run db:reset-admin` (runs reset-full-db + this flag).
 */
const SEED_ADMIN_ONLY =
  process.env.SEED_ADMIN_ONLY === "1" ||
  process.env.SEED_ADMIN_ONLY?.toLowerCase() === "true";

/** Delete all business rows so you can test from a clean slate. Keeps roles / permissions / size lookup definitions (re-upserted below). */
async function wipeTransactionalData(client: PrismaClient) {
  await client.idempotencyKey.deleteMany();
  await client.auditLog.deleteMany();
  await client.weighSession.deleteMany();
  await client.truckPhoto.deleteMany();
  await client.truckRequestItem.deleteMany();
  await client.truckOperation.deleteMany();
  await client.paymentAllocation.deleteMany();
  await client.paymentSlice.deleteMany();
  await client.orderItem.deleteMany();
  await client.salesOrder.deleteMany();
  await client.contractAttachment.deleteMany();
  await client.masterContract.deleteMany();
  await client.payment.deleteMany();
  await client.customer.deleteMany();
  await client.userPermissionOverride.deleteMany();
  await client.user.deleteMany({
    where: { username: { notIn: ["system", "admin"] } },
  });
}

/** Original slice demo customers (removed and recreated each seed). */
const DEMO_SEED_NATIONAL_IDS = [
  "DEMO-SEED-001",
  "DEMO-SEED-002",
  "DEMO-SEED-003",
  "DEMO-SEED-004",
  "DEMO-SEED-005",
  "DEMO-SEED-006",
  "DEMO-SEED-007",
  "DEMO-SEED-008",
  "DEMO-SEED-009",
  "DEMO-SEED-010",
] as const;

/** Large UI dataset: customers, one contract each, one sales order each. */
const DEMO_BULK_CUSTOMER_COUNT = 50;
const DEMO_BULK_NATIONAL_IDS = Array.from(
  { length: DEMO_BULK_CUSTOMER_COUNT },
  (_, i) => `DEMO-BULK-${String(i + 1).padStart(3, "0")}`
);

const ALL_DEMO_CUSTOMER_NATIONAL_IDS = [
  ...DEMO_SEED_NATIONAL_IDS,
  ...DEMO_BULK_NATIONAL_IDS,
];

async function main() {
  console.log("Seeding database...");

  if (SEED_ADMIN_ONLY) {
    console.log(
      "  → SEED_ADMIN_ONLY: مسح الزبائن، العقود، أوامر البيع، الشاحنات، الدفعات، مفاتيح الطلبات المكررة، سجل التدقيق، ومستخدمي التجربة…",
    );
    await wipeTransactionalData(prisma);
  }

  // ─── Roles ────────────────────────────────────────────────────
  for (const role of RBAC_ROLES) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { displayName: role.displayName },
      create: role,
    });
  }
  console.log("  ✓ Roles seeded");

  // ─── Permissions ──────────────────────────────────────────────
  for (const perm of RBAC_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: { displayName: perm.displayName, module: perm.module },
      create: perm,
    });
  }
  console.log("  ✓ Permissions seeded");

  // ─── Role Default Permissions ─────────────────────────────────
  for (const [roleCode, permCodes] of Object.entries(RBAC_ROLE_PERMISSIONS)) {
    for (const permCode of permCodes) {
      await prisma.roleDefaultPermission.upsert({
        where: {
          roleCode_permissionCode: { roleCode, permissionCode: permCode },
        },
        update: {},
        create: { roleCode, permissionCode: permCode },
      });
    }
    // Remove stale mappings that are no longer in the desired set
    await prisma.roleDefaultPermission.deleteMany({
      where: {
        roleCode,
        permissionCode: { notIn: [...permCodes] },
      },
    });
  }
  console.log("  ✓ Role-permission mappings seeded (stale removed)");

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
    { code: "shortbar_1_4m", displayName: "قصائر 1–4 م", isSpecialRatio: false, subjectToTolerance: true, isBundleType: false, isActive: true, sortOrder: 10 },
    { code: "shortbar_4_12m", displayName: "قصائر 4–12 م", isSpecialRatio: false, subjectToTolerance: true, isBundleType: false, isActive: true, sortOrder: 11 },
    { code: "scrap", displayName: "خردة (Scrap)", isSpecialRatio: false, subjectToTolerance: true, isBundleType: false, isActive: true, sortOrder: 12 },
    { code: "billet_wire_6mm", displayName: "أسلاك تربيط بيلت مستورد 6 mm", isSpecialRatio: false, subjectToTolerance: true, isBundleType: false, isActive: true, sortOrder: 13 },
    { code: "6mm", displayName: "6 مم", isSpecialRatio: false, subjectToTolerance: true, isBundleType: true, isActive: false, sortOrder: 0 },
  ];

  // Remove legacy "shortbar" if it exists (replaced by shortbar_1_4m / shortbar_4_12m)
  await prisma.sizeLookup.deleteMany({ where: { code: "shortbar" } });

  for (const size of sizes) {
    await prisma.sizeLookup.upsert({
      where: { code: size.code },
      update: size,
      create: size,
    });
  }
  console.log("  ✓ Sizes seeded");

  // ─── Destination Lookup ────────────────────────────────────────
  const destinations = [
    { name: "دمشق", details: "المدينة والمناطق المحيطة", isActive: true, sortOrder: 1 },
    { name: "ريف دمشق", details: "المنطقة الصناعية والمستودعات", isActive: true, sortOrder: 2 },
    { name: "حمص", details: "المنطقة الوسطى", isActive: true, sortOrder: 3 },
    { name: "حماة", details: "المنطقة الوسطى", isActive: true, sortOrder: 4 },
    { name: "حلب", details: "المنطقة الشمالية", isActive: true, sortOrder: 5 },
    { name: "اللاذقية", details: "الساحل", isActive: true, sortOrder: 6 },
    { name: "طرطوس", details: "الساحل", isActive: true, sortOrder: 7 },
    { name: "درعا", details: "المنطقة الجنوبية", isActive: true, sortOrder: 8 },
    { name: "السويداء", details: "المنطقة الجنوبية", isActive: true, sortOrder: 9 },
    { name: "إدلب", details: "المنطقة الشمالية", isActive: true, sortOrder: 10 },
    { name: "الحسكة", details: "المنطقة الشرقية", isActive: true, sortOrder: 11 },
    { name: "دير الزور", details: "المنطقة الشرقية", isActive: true, sortOrder: 12 },
    { name: "الرقة", details: "المنطقة الشرقية", isActive: true, sortOrder: 13 },
    { name: "القنيطرة", details: "المنطقة الجنوبية", isActive: true, sortOrder: 14 },
  ];

  for (const destination of destinations) {
    await prisma.destination.upsert({
      where: { name: destination.name },
      update: destination,
      create: destination,
    });
  }
  console.log("  ✓ Destinations seeded");

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
  const adminPassword = await hash("admin123", 10);
  await prisma.user.upsert({
    where: { username: "admin" },
    update: SEED_ADMIN_ONLY
      ? {
          passwordHash: adminPassword,
          fullName: "المدير العام",
          roleCode: "admin",
          isActive: true,
        }
      : {},
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

  if (SEED_ADMIN_ONLY) {
    console.log(
      "  ✓ وضع admin فقط: تم تخطي بيانات التجربة. للدخول: admin / admin123 (مستخدم system داخلي غير قابل لتسجيل الدخول).",
    );
    console.log("\nSeeding complete!");
    return;
  }

  // ─── Demo users per role (dev / QA) ───────────────────────────
  const demoUserPassword = await hash("demo123", 10);
  const demoUsers: Array<{
    username: string;
    fullName: string;
    roleCode:
      | "finance"
      | "logistics"
      | "scale_operator"
      | "internal_loader"
      | "manager";
  }> = [
    { username: "finance", fullName: "موظف المالية (تجريبي)", roleCode: "finance" },
    { username: "logistics", fullName: "موظف اللوجستيك (تجريبي)", roleCode: "logistics" },
    { username: "scale", fullName: "عامل القبان الخارجي (تجريبي)", roleCode: "scale_operator" },
    { username: "loader", fullName: "عامل التحميل الداخلي (تجريبي)", roleCode: "internal_loader" },
    { username: "manager", fullName: "صاحب المصنع", roleCode: "manager" },
  ];
  for (const u of demoUsers) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: {
        passwordHash: demoUserPassword,
        fullName: u.fullName,
        roleCode: u.roleCode,
        isActive: true,
      },
      create: {
        username: u.username,
        passwordHash: demoUserPassword,
        fullName: u.fullName,
        roleCode: u.roleCode,
        isActive: true,
        createdById: systemUser.id,
      },
    });
  }
  console.log("  * Role demo users (password for all: demo123): finance, logistics, scale, loader");

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
    where: { nationalId: { in: [...ALL_DEMO_CUSTOMER_NATIONAL_IDS] } },
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
      // Delete sales order items first, then sales orders, then contract attachments, then contracts
      const demoSOs = await prisma.salesOrder.findMany({
        where: { contractNumber: { in: demoContractNumbers } },
        select: { orderNumber: true },
      });
      const demoSONumbers = demoSOs.map((s) => s.orderNumber);
      if (demoSONumbers.length > 0) {
        const trucksWithSO = await prisma.truckOperation.findMany({
          where: { salesOrderNumber: { in: demoSONumbers } },
          select: { id: true },
        });
        const truckIds = trucksWithSO.map((t) => t.id);
        if (truckIds.length > 0) {
          await prisma.weighSession.deleteMany({ where: { truckOperationId: { in: truckIds } } });
          await prisma.truckPhoto.deleteMany({ where: { truckOperationId: { in: truckIds } } });
          await prisma.truckRequestItem.deleteMany({ where: { truckOperationId: { in: truckIds } } });
          await prisma.truckOperation.deleteMany({ where: { id: { in: truckIds } } });
        }
        await prisma.paymentAllocation.deleteMany({ where: { orderNumber: { in: demoSONumbers } } });
        await prisma.paymentSlice.deleteMany({ where: { orderNumber: { in: demoSONumbers } } });
        await prisma.orderItem.deleteMany({ where: { orderNumber: { in: demoSONumbers } } });
        await prisma.salesOrder.deleteMany({ where: { orderNumber: { in: demoSONumbers } } });
      }
      await prisma.contractAttachment.deleteMany({
        where: { contractNumber: { in: demoContractNumbers } },
      });
      await prisma.masterContract.deleteMany({
        where: { contractNumber: { in: demoContractNumbers } },
      });
    }
    const demoPayments = await prisma.payment.findMany({
      where: { customerId: { in: demoCustomerIds } },
      select: { id: true },
    });
    const demoPaymentIds = demoPayments.map((p) => p.id);
    if (demoPaymentIds.length > 0) {
      await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: demoPaymentIds } } });
      await prisma.payment.deleteMany({ where: { id: { in: demoPaymentIds } } });
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
    {
      code: "C-DEMO-06",
      fullName: "سامر عبد الرحمن الناصر",
      fatherName: "عبد الرحمن",
      nationalId: "DEMO-SEED-006",
      phonePrimary: "0933444555",
      phoneSecondary: null,
      companyAddress: "درعا — الشهباء",
      commercialRegistration: null,
      notes: "عميل تجريبي — عقد نشط (مجموعة البيانات الموسّعة).",
      isActive: true,
    },
    {
      code: "C-DEMO-07",
      fullName: "مؤسسة الأمان للإنشاءات",
      fatherName: "طارق",
      nationalId: "DEMO-SEED-007",
      phonePrimary: "021-556677",
      phoneSecondary: null,
      companyAddress: "ريف دمشق — عدرا",
      commercialRegistration: "CR-200220",
      notes: "عميل تجريبي — شركة.",
      isActive: true,
    },
    {
      code: "C-DEMO-08",
      fullName: "ليلى حسن المصري",
      fatherName: "حسن",
      nationalId: "DEMO-SEED-008",
      phonePrimary: "0944555666",
      phoneSecondary: "0944555667",
      companyAddress: "إدلب — معرة النعمان",
      commercialRegistration: null,
      notes: "عميل تجريبي — عقد معلّق.",
      isActive: true,
    },
    {
      code: "C-DEMO-09",
      fullName: "عمر ديب الخطيب",
      fatherName: "ديب",
      nationalId: "DEMO-SEED-009",
      phonePrimary: "0955111222",
      phoneSecondary: null,
      companyAddress: "السويداء — شهبا",
      commercialRegistration: null,
      notes: "عميل تجريبي — عدة أوامر بيع.",
      isActive: true,
    },
    {
      code: "C-DEMO-10",
      fullName: "ورشة الحدادة الحديثة",
      fatherName: "بسام",
      nationalId: "DEMO-SEED-010",
      phonePrimary: "033-889900",
      phoneSecondary: null,
      companyAddress: "دمشق — كفر سوسة",
      commercialRegistration: "CR-303030",
      notes: "عميل تجريبي — أمر ملغى للعرض.",
      isActive: true,
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
    {
      contractNumber: `${yy}-94`,
      customerNationalId: "DEMO-SEED-006",
      status: "active",
      notes: "عقد تجريبي موسّع — درعا.",
    },
    {
      contractNumber: `${yy}-95`,
      customerNationalId: "DEMO-SEED-007",
      status: "active",
      notes: "عقد تجريبي موسّع — مؤسسة الأمان.",
    },
    {
      contractNumber: `${yy}-96`,
      customerNationalId: "DEMO-SEED-008",
      status: "suspended",
      notes: "عقد معلّق — بيانات موسّعة.",
    },
    {
      contractNumber: `${yy}-97`,
      customerNationalId: "DEMO-SEED-009",
      status: "active",
      notes: "عقد نشط — السويداء.",
    },
    {
      contractNumber: `${yy}-98`,
      customerNationalId: "DEMO-SEED-010",
      status: "active",
      notes: "عقد نشط — ورشة الحدادة.",
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

  // ─── Demo Sales Orders (Slice 2) ──────────────────────────────
  const sizeLookup = await prisma.sizeLookup.findMany();
  const sizeByCode = (code: string) => sizeLookup.find((s) => s.code === code)!;

  const rebarPrices: Array<{ code: string; price: number }> = [
    { code: "8mm", price: 620 },
    { code: "10mm", price: 610 },
    { code: "12mm", price: 590 },
    { code: "14mm", price: 590 },
    { code: "16mm", price: 590 },
    { code: "18mm", price: 590 },
    { code: "20mm", price: 590 },
    { code: "22mm", price: 590 },
    { code: "25mm", price: 590 },
  ];

  const seedRebarOrderItems = async (orderNumber: string) => {
    for (const rp of rebarPrices) {
      const size = sizeByCode(rp.code);
      if (size) {
        await prisma.orderItem.create({
          data: {
            orderNumber,
            sizeId: size.id,
            pricePerTon: rp.price,
          },
        });
      }
    }
  };

  const activeContractNumber = `${yy}-90`; // DEMO-SEED-001

  const so1Number = `${activeContractNumber}-001`;
  await prisma.salesOrder.create({
    data: {
      orderNumber: so1Number,
      contractNumber: activeContractNumber,
      kind: "REBAR",
      grade: "FIRST",
      settlementMode: "CREDIT",
      paymentDeadlineDays: 28,
      totalQtyTons: 500,
      toleranceType: "percentage",
      toleranceValue: 5,
      specialRatioPct: 10,
      orderDate: new Date(),
      deliveryDate: new Date(Date.now() + 90 * 86400000),
      status: "approved",
      notes: "أمر بيع تجريبي — مبروم نخب أول، آجل 28 يوم.",
      createdById: systemUser.id,
    },
  });
  await seedRebarOrderItems(so1Number);

  const so2Number = `${activeContractNumber}-002`;
  await prisma.salesOrder.create({
    data: {
      orderNumber: so2Number,
      contractNumber: activeContractNumber,
      kind: "SCRAP",
      settlementMode: "PAYMENT_PLAN",
      totalQtyTons: 100,
      toleranceType: "weight",
      toleranceValue: 10,
      orderDate: new Date(),
      deliveryDate: new Date(Date.now() + 60 * 86400000),
      status: "draft",
      notes: "أمر بيع تجريبي — خردة، نظام دفعات.",
      createdById: systemUser.id,
    },
  });
  const scrapSize = sizeByCode("scrap");
  if (scrapSize) {
    await prisma.orderItem.create({
      data: {
        orderNumber: so2Number,
        sizeId: scrapSize.id,
        pricePerTon: 200,
      },
    });
  }

  const so3Number = `${activeContractNumber}-003`;
  await prisma.salesOrder.create({
    data: {
      orderNumber: so3Number,
      contractNumber: activeContractNumber,
      kind: "REBAR",
      grade: "SECOND",
      settlementMode: "CREDIT",
      paymentDeadlineDays: 21,
      totalQtyTons: 120,
      toleranceType: "percentage",
      toleranceValue: 5,
      specialRatioPct: 8,
      orderDate: new Date(),
      deliveryDate: new Date(Date.now() + 45 * 86400000),
      status: "in_progress",
      notes: "أمر بيع تجريبي — مبروم نخب ثاني.",
      createdById: systemUser.id,
    },
  });
  await seedRebarOrderItems(so3Number);

  const c91 = `${yy}-91`;
  const so91001 = `${c91}-001`;
  await prisma.salesOrder.create({
    data: {
      orderNumber: so91001,
      contractNumber: c91,
      kind: "REBAR",
      grade: "FIRST",
      settlementMode: "CREDIT",
      paymentDeadlineDays: 30,
      totalQtyTons: 300,
      toleranceType: "percentage",
      toleranceValue: 5,
      orderDate: new Date(),
      deliveryDate: new Date(Date.now() + 75 * 86400000),
      status: "approved",
      notes: "أمر بيع تجريبي — عقد 91، مبروم أول.",
      createdById: systemUser.id,
    },
  });
  await seedRebarOrderItems(so91001);

  const so91002 = `${c91}-002`;
  await prisma.salesOrder.create({
    data: {
      orderNumber: so91002,
      contractNumber: c91,
      kind: "SHORTBAR_4_12M",
      settlementMode: "PAYMENT_PLAN",
      totalQtyTons: 40,
      toleranceType: "weight",
      toleranceValue: 5,
      orderDate: new Date(),
      deliveryDate: new Date(Date.now() + 30 * 86400000),
      status: "draft",
      notes: "أمر بيع تجريبي — قصائر 4–12 م.",
      createdById: systemUser.id,
    },
  });
  const shortbar412 = sizeByCode("shortbar_4_12m");
  if (shortbar412) {
    await prisma.orderItem.create({
      data: {
        orderNumber: so91002,
        sizeId: shortbar412.id,
        pricePerTon: 575,
      },
    });
  }

  const c93 = `${yy}-93`;
  const so93001 = `${c93}-001`;
  await prisma.salesOrder.create({
    data: {
      orderNumber: so93001,
      contractNumber: c93,
      kind: "REBAR",
      grade: "FIRST",
      settlementMode: "CREDIT",
      paymentDeadlineDays: 28,
      totalQtyTons: 200,
      toleranceType: "percentage",
      toleranceValue: 5,
      orderDate: new Date(),
      deliveryDate: new Date(Date.now() + 50 * 86400000),
      status: "approved",
      notes: "أمر بيع تجريبي — عقد 93.",
      createdById: systemUser.id,
    },
  });
  await seedRebarOrderItems(so93001);

  const c94 = `${yy}-94`;
  const so94001 = `${c94}-001`;
  await prisma.salesOrder.create({
    data: {
      orderNumber: so94001,
      contractNumber: c94,
      kind: "REBAR",
      grade: "FIRST",
      settlementMode: "CREDIT",
      paymentDeadlineDays: 28,
      totalQtyTons: 150,
      toleranceType: "percentage",
      toleranceValue: 5,
      orderDate: new Date(),
      deliveryDate: new Date(Date.now() + 40 * 86400000),
      status: "draft",
      notes: "أمر بيع تجريبي — مسودة (درعا).",
      createdById: systemUser.id,
    },
  });
  await seedRebarOrderItems(so94001);

  const c95 = `${yy}-95`;
  const so95001 = `${c95}-001`;
  await prisma.salesOrder.create({
    data: {
      orderNumber: so95001,
      contractNumber: c95,
      kind: "SCRAP",
      settlementMode: "PAYMENT_PLAN",
      totalQtyTons: 55,
      toleranceType: "weight",
      toleranceValue: 8,
      orderDate: new Date(),
      deliveryDate: new Date(Date.now() + 20 * 86400000),
      status: "draft",
      notes: "أمر بيع تجريبي — خردة (مؤسسة الأمان).",
      createdById: systemUser.id,
    },
  });
  if (scrapSize) {
    await prisma.orderItem.create({
      data: {
        orderNumber: so95001,
        sizeId: scrapSize.id,
        pricePerTon: 195,
      },
    });
  }

  const c98 = `${yy}-98`;
  const so98001 = `${c98}-001`;
  await prisma.salesOrder.create({
    data: {
      orderNumber: so98001,
      contractNumber: c98,
      kind: "REBAR",
      grade: "FIRST",
      settlementMode: "CREDIT",
      paymentDeadlineDays: 14,
      totalQtyTons: 80,
      toleranceType: "percentage",
      toleranceValue: 5,
      orderDate: new Date(),
      deliveryDate: new Date(Date.now() + 10 * 86400000),
      status: "cancelled",
      notes: "أمر بيع تجريبي — ملغى للعرض.",
      createdById: systemUser.id,
    },
  });
  await seedRebarOrderItems(so98001);

  console.log("  ✓ Demo sales orders seeded (8 SOs with price items)");

  // ─── Bulk demo: 50 customers, 50 contracts, 50 sales orders ───
  const bulkCities = [
    "دمشق",
    "حلب",
    "حمص",
    "اللاذقية",
    "طرطوس",
    "درعا",
    "السويداء",
    "إدلب",
    "الحسكة",
    "دير الزور",
  ];
  const bulkKinds: Array<
    "REBAR" | "SCRAP" | "SHORTBAR_1_4M" | "SHORTBAR_4_12M"
  > = ["REBAR", "REBAR", "SCRAP", "SHORTBAR_4_12M", "SHORTBAR_1_4M"];
  const bulkStatuses: Array<
    "draft" | "approved" | "in_progress" | "completed" | "cancelled"
  > = ["draft", "approved", "in_progress", "completed", "cancelled"];

  const addBulkRebarItems = async (orderNumber: string, priceBump: number) => {
    const codes = ["8mm", "10mm", "12mm", "14mm"] as const;
    for (const code of codes) {
      const rp = rebarPrices.find((r) => r.code === code);
      const size = sizeByCode(code);
      if (rp && size) {
        await prisma.orderItem.create({
          data: {
            orderNumber,
            sizeId: size.id,
            pricePerTon: rp.price + priceBump,
          },
        });
      }
    }
  };

  for (let i = 0; i < DEMO_BULK_CUSTOMER_COUNT; i++) {
    const seq = i + 1;
    const nationalId = `DEMO-BULK-${String(seq).padStart(3, "0")}`;
    const customer = await prisma.customer.create({
      data: {
        code: `C-BULK-${String(seq).padStart(3, "0")}`,
        fullName: `عميل تجريبي جماعي ${seq}`,
        fatherName: `والد ${seq}`,
        nationalId,
        phonePrimary: `0944${String(100000 + seq).padStart(6, "0")}`,
        phoneSecondary: seq % 5 === 0 ? `011-${String(2000000 + seq).slice(0, 7)}` : null,
        companyAddress: `${bulkCities[i % bulkCities.length]} — منطقة تجريبية ${seq}`,
        commercialRegistration: seq % 4 === 0 ? `CR-BULK-${seq}` : null,
        notes: `بيانات تجريبية جماعية للواجهات — عميل ${seq}`,
        isActive: seq % 17 !== 0,
        createdById: systemUser.id,
      },
    });

    const contractNumber = `${yy}-${String(40 + i).padStart(2, "0")}`;
    const contractStatus = i % 11 === 0 ? "suspended" : "active";
    await prisma.masterContract.create({
      data: {
        contractNumber,
        customerId: customer.id,
        attachmentPath: seedAttachmentPath,
        status: contractStatus,
        notes: `عقد تجريبي جماعي — ${contractNumber}`,
        createdById: systemUser.id,
      },
    });
    await prisma.contractAttachment.create({
      data: {
        contractNumber,
        filePath: seedAttachmentPath,
        fileName: seedAttachmentFileName,
        fileSize: Buffer.byteLength(minimalPdf, "utf8"),
        uploadedById: systemUser.id,
      },
    });

    const kind = bulkKinds[i % bulkKinds.length];
    const orderStatus = bulkStatuses[i % bulkStatuses.length];
    const orderNumber = `${contractNumber}-001`;
    const settlementMode: SettlementMode =
      i % 3 === 0 ? "PAYMENT_PLAN" : "CREDIT";
    const priceBump = i % 7;

    const baseSo = {
      orderNumber,
      contractNumber,
      kind,
      settlementMode,
      totalQtyTons: 40 + (i % 15) * 10,
      toleranceType: i % 2 === 0 ? ("percentage" as const) : ("weight" as const),
      toleranceValue: i % 2 === 0 ? 5 : 8,
      orderDate: new Date(Date.now() - (i % 60) * 86400000),
      deliveryDate: new Date(Date.now() + (20 + (i % 40)) * 86400000),
      status: orderStatus,
      notes: `أمر بيع تجريبي جماعي — ${orderNumber}`,
      createdById: systemUser.id,
    };

    if (kind === "REBAR") {
      const grade = i % 2 === 0 ? "FIRST" : "SECOND";
      await prisma.salesOrder.create({
        data: {
          ...baseSo,
          grade,
          paymentDeadlineDays:
            settlementMode === "CREDIT" ? 14 + (i % 21) : null,
          specialRatioPct: grade === "FIRST" ? 10 : 8,
        },
      });
      await addBulkRebarItems(orderNumber, priceBump);
    } else {
      await prisma.salesOrder.create({
        data: {
          ...baseSo,
          grade: null,
          paymentDeadlineDays:
            settlementMode === "CREDIT" ? 14 + (i % 21) : null,
          specialRatioPct: null,
        },
      });
      if (kind === "SCRAP") {
        const scrapSize = sizeByCode("scrap");
        if (scrapSize) {
          await prisma.orderItem.create({
            data: {
              orderNumber,
              sizeId: scrapSize.id,
              pricePerTon: 190 + (i % 15),
            },
          });
        }
      } else {
        const sbCode = kind === "SHORTBAR_4_12M" ? "shortbar_4_12m" : "shortbar_1_4m";
        const sb = sizeByCode(sbCode);
        if (sb) {
          await prisma.orderItem.create({
            data: {
              orderNumber,
              sizeId: sb.id,
              pricePerTon: 560 + (i % 20),
            },
          });
        }
      }
    }
  }
  console.log(
    `  ✓ Bulk demo seeded (${DEMO_BULK_CUSTOMER_COUNT} customers, ${DEMO_BULK_CUSTOMER_COUNT} contracts, ${DEMO_BULK_CUSTOMER_COUNT} sales orders)`
  );

  // ─── Demo Payments (Phase B) ──────────────────────────────────
  const demoPaymentsData: Array<{
    customerNationalId: string;
    amount: number;
    method: "CASH" | "BANK_TRANSFER" | "CHECK";
    daysAgo: number;
    referenceNumber: string | null;
    notes: string | null;
  }> = [
    {
      customerNationalId: "DEMO-SEED-001",
      amount: 50000,
      method: "BANK_TRANSFER",
      daysAgo: 20,
      referenceNumber: "TRF-2026-001",
      notes: "دفعة أولى — تحويل بنكي.",
    },
    {
      customerNationalId: "DEMO-SEED-001",
      amount: 25000,
      method: "CASH",
      daysAgo: 10,
      referenceNumber: null,
      notes: "دفعة نقدية ثانية.",
    },
    {
      customerNationalId: "DEMO-SEED-002",
      amount: 80000,
      method: "BANK_TRANSFER",
      daysAgo: 15,
      referenceNumber: "TRF-2026-002",
      notes: "دفعة أولية — عقد 91.",
    },
    {
      customerNationalId: "DEMO-SEED-004",
      amount: 30000,
      method: "CHECK",
      daysAgo: 5,
      referenceNumber: "CHK-0042",
      notes: "شيك — عقد 93.",
    },
    {
      customerNationalId: "DEMO-SEED-006",
      amount: 15000,
      method: "CASH",
      daysAgo: 3,
      referenceNumber: null,
      notes: "دفعة نقدية — درعا.",
    },
  ];

  for (const dp of demoPaymentsData) {
    const custId = byNid(dp.customerNationalId);
    await prisma.payment.create({
      data: {
        customerId: custId,
        amount: dp.amount,
        method: dp.method,
        paymentDate: new Date(Date.now() - dp.daysAgo * 86400000),
        referenceNumber: dp.referenceNumber,
        notes: dp.notes,
        createdById: systemUser.id,
      },
    });
  }
  console.log(`  ✓ Demo payments seeded (${demoPaymentsData.length} payments)`);

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
