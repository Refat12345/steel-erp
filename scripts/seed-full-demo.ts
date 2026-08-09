/**
 * Full industrial demo dataset for weighbridge / ERP screenshots (customers, trucks, sessions, audit).
 * Run after: npx tsx scripts/reset-full-db.ts
 *
 * Usage: npx tsx scripts/seed-full-demo.ts
 *
 * Default password for all human accounts: Demo2026!
 * (admin included — change after demo.)
 */
import "dotenv/config";
import {
  Prisma,
  PrismaClient,
  type AuditAction,
  type TruckStatus,
} from "@prisma/client";
import { hash } from "bcryptjs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const prisma = new PrismaClient();

const DEMO_PLAIN_PASSWORD = "Demo2026!";
const TRUCK_COUNT = 80;
const CUSTOMER_COUNT = 12;

/** ~67% active → 8 active, 4 inactive for 12 customers (close to 70/30) */
const ACTIVE_CUSTOMERS = 8;

const STATUS_BLOCKS: TruckStatus[] = [
  ...Array(32).fill("Completed" as const),
  ...Array(20).fill("LoadingComplete" as const),
  ...Array(16).fill("OnScale" as const),
  ...Array(8).fill("FirstWeigh" as const),
  ...Array(4).fill("Cancelled" as const),
];

const PLATE_GOV = [
  "دمشق",
  "حلب",
  "حمص",
  "اللاذقية",
  "طرطوس",
  "حماة",
  "إدلب",
  "درعا",
];

function rng(): number {
  return Math.random();
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function addMinutes(d: Date, min: number): Date {
  return new Date(d.getTime() + min * 60_000);
}

/** Last 7 days, 60% morning 08:00–12:00, 40% afternoon 14:00–19:00 */
function randomFactoryTimestamp(): Date {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const offsetDays = randInt(0, 6);
  const base = addMinutes(dayStart, offsetDays * 24 * 60);
  const morning = rng() < 0.6;
  const startH = morning ? 8 : 14;
  const endH = morning ? 12 : 19;
  const hour = startH + rng() * (endH - startH);
  const minute = rng() * 60;
  const second = rng() * 60;
  return addMinutes(
    base,
    hour * 60 + minute + second / 60,
  );
}

function randomPlate(): string {
  const g = PLATE_GOV[randInt(0, PLATE_GOV.length - 1)]!;
  const num = String(randInt(100000, 999999));
  return `${g} - ${num}`;
}

/** Tare 8_000–18_000 kg; gross 20_000–45_000 kg; net ≥ 500 kg */
function randomTareGross(): { tare: number; gross: number } {
  const tare = randInt(8000, 18000);
  const grossMin = Math.max(20000, tare + 500);
  const gross = randInt(grossMin, 45000);
  return { tare, gross };
}

type StaffUser = {
  id: number;
  username: string;
  roleCode: string;
};

async function ensureRbacAndSizes(): Promise<void> {
  const roles = [
    { code: "admin", displayName: "المدير العام" },
    { code: "finance", displayName: "المالية" },
    { code: "logistics", displayName: "اللوجستيك" },
    { code: "scale_operator", displayName: "موظف القبان الخارجي" },
    { code: "internal_loader", displayName: "عامل التحميل الداخلي" },
  ];
  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { displayName: role.displayName },
      create: role,
    });
  }

  const permissions = [
    { code: "contract.create", displayName: "إنشاء عقد", module: "contracts" },
    { code: "contract.edit", displayName: "تعديل عقد", module: "contracts" },
    { code: "contract.change_status", displayName: "تغيير حالة عقد", module: "contracts" },
    { code: "contract.view", displayName: "عرض العقود", module: "contracts" },
    { code: "salesorder.create", displayName: "إنشاء أمر بيع", module: "sales" },
    { code: "salesorder.edit_draft", displayName: "تعديل مسودة أمر بيع", module: "sales" },
    { code: "salesorder.set_price", displayName: "تثبيت الأسعار", module: "sales" },
    { code: "salesorder.approve", displayName: "اعتماد أمر بيع", module: "sales" },
    { code: "salesorder.edit_approved", displayName: "تعديل بعد الاعتماد", module: "sales" },
    { code: "salesorder.cancel", displayName: "إلغاء أمر بيع", module: "sales" },
    { code: "salesorder.view", displayName: "عرض أوامر البيع", module: "sales" },
    { code: "truck.register", displayName: "تسجيل شاحنة", module: "logistics" },
    { code: "truck.edit_queued", displayName: "تعديل شاحنة بالطابور", module: "logistics" },
    { code: "truck.view_queue", displayName: "عرض الطابور", module: "logistics" },
    { code: "truck.view_approved", displayName: "عرض المعتمدة فقط", module: "logistics" },
    { code: "payment.create", displayName: "إدخال دفعة مالية", module: "finance" },
    { code: "payment.view", displayName: "عرض الدفعات", module: "finance" },
    { code: "creditlimit.set", displayName: "محجوز — غير مستخدم في v1", module: "finance" },
    { code: "buffer.grant", displayName: "منح Buffer", module: "finance" },
    { code: "specialratio.override", displayName: "موافقة تجاوز النسبة الخاصة", module: "finance" },
    { code: "scale.start", displayName: "بدء عملية وزن", module: "scale" },
    { code: "scale.enter_tare", displayName: "إدخال وزن الفارغ", module: "scale" },
    { code: "scale.enter_gross", displayName: "إدخال وزن المحمّل", module: "scale" },
    { code: "scale.enter_session", displayName: "إدخال وزنة داخلية", module: "scale" },
    { code: "scale.edit_session", displayName: "تعديل وزنة", module: "scale" },
    { code: "scale.delete_session", displayName: "حذف وزنة داخلية", module: "scale" },
    { code: "scale.upload_photo", displayName: "رفع صورة", module: "scale" },
    { code: "scale.loading_complete", displayName: "تأكيد اكتمال التحميل", module: "scale" },
    { code: "scale.reopen_before_gross", displayName: "إعادة فتح التحميل قبل الجروس", module: "scale" },
    { code: "scale.close", displayName: "إغلاق نهائي وطباعة كرت", module: "scale" },
    { code: "scale.cancel", displayName: "إلغاء عملية مع سبب", module: "scale" },
    { code: "scale.correct_completed", displayName: "تصحيح إداري لشاحنة مكتملة", module: "scale" },
    { code: "forcepass.execute", displayName: "تمرير إجباري", module: "admin" },
    { code: "user.manage", displayName: "إدارة المستخدمين", module: "admin" },
    { code: "user.set_permissions", displayName: "تعديل صلاحيات المستخدمين", module: "admin" },
    { code: "settings.edit", displayName: "تعديل الإعدادات العامة", module: "admin" },
    { code: "reports.view", displayName: "الوصول إلى قسم التقارير", module: "reports" },
    { code: "report.daily_trucks", displayName: "تقرير شاحنات يومي", module: "reports" },
    { code: "report.customer_balance", displayName: "تقرير رصيد زبون", module: "reports" },
    { code: "report.salesorder_status", displayName: "تقرير حالة أمر بيع", module: "reports" },
    { code: "report.audit", displayName: "تقرير التدقيق", module: "reports" },
    { code: "dashboard.view", displayName: "عرض لوحة المؤشرات والإحصاءات", module: "analytics" },
  ];
  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: { displayName: perm.displayName, module: perm.module },
      create: perm,
    });
  }

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
      "reports.view",
      "report.customer_balance",
      "report.salesorder_status",
      "report.audit",
      "dashboard.view",
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
    ],
    scale_operator: [
      "truck.view_approved",
      "scale.start",
      "scale.enter_tare",
      "scale.enter_gross",
      "scale.close",
      "scale.cancel",
    ],
    internal_loader: [
      "truck.view_approved",
      "scale.enter_session",
      "scale.edit_session",
      "scale.delete_session",
      "scale.upload_photo",
      "scale.loading_complete",
      "scale.reopen_before_gross",
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
    await prisma.roleDefaultPermission.deleteMany({
      where: {
        roleCode,
        permissionCode: { notIn: permCodes },
      },
    });
  }

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
    { code: "32mm", displayName: "32 مم", isSpecialRatio: false, subjectToTolerance: true, isBundleType: true, isActive: true, sortOrder: 10 },
    { code: "shortbar_1_4m", displayName: "قصائر 1–4 م", isSpecialRatio: false, subjectToTolerance: true, isBundleType: false, isActive: true, sortOrder: 11 },
    { code: "shortbar_4_12m", displayName: "قصائر 4–12 م", isSpecialRatio: false, subjectToTolerance: true, isBundleType: false, isActive: true, sortOrder: 12 },
    { code: "scrap", displayName: "خردة (Scrap)", isSpecialRatio: false, subjectToTolerance: true, isBundleType: false, isActive: true, sortOrder: 13 },
    { code: "billet_wire_6mm", displayName: "أسلاك تربيط بيلت مستورد 6 mm", isSpecialRatio: false, subjectToTolerance: true, isBundleType: false, isActive: true, sortOrder: 14 },
    { code: "rebar_under_70cm", displayName: "مبروم أقل من 70 سم", isSpecialRatio: false, subjectToTolerance: true, isBundleType: false, isActive: true, sortOrder: 15 },
    { code: "billet_scrap_10m", displayName: "بيلت خردة 10m", isSpecialRatio: false, subjectToTolerance: true, isBundleType: false, isActive: true, sortOrder: 16 },
    { code: "scrap_50cm_1m", displayName: "سكراب من 50 سم إلى 1 م", isSpecialRatio: false, subjectToTolerance: true, isBundleType: false, isActive: true, sortOrder: 17 },
    { code: "6mm", displayName: "6 مم", isSpecialRatio: false, subjectToTolerance: true, isBundleType: true, isActive: false, sortOrder: 0 },
  ];
  await prisma.sizeLookup.deleteMany({ where: { code: "shortbar" } });
  for (const size of sizes) {
    await prisma.sizeLookup.upsert({
      where: { code: size.code },
      update: size,
      create: size,
    });
  }
}

function auditDetail(
  roleCode: string,
  body: Record<string, unknown>,
): Prisma.InputJsonValue {
  return { role: roleCode, ...body } as Prisma.InputJsonValue;
}

async function main() {
  await ensureRbacAndSizes();

  const passwordHash = await hash(DEMO_PLAIN_PASSWORD, 10);

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

  const humanSpecs: Array<{
    username: string;
    fullName: string;
    roleCode: string;
  }> = [
    { username: "admin", fullName: "المدير العام", roleCode: "admin" },
    { username: "scale_op_01", fullName: "فادي الأسود", roleCode: "scale_operator" },
    { username: "scale_op_02", fullName: "ليلى مرعي", roleCode: "scale_operator" },
    { username: "scale_op_03", fullName: "طارق يوسف", roleCode: "scale_operator" },
    { username: "loader_01", fullName: "خالد عبود", roleCode: "internal_loader" },
    { username: "loader_02", fullName: "رامي السعدي", roleCode: "internal_loader" },
    { username: "logistics_01", fullName: "نديم الخوري", roleCode: "logistics" },
    { username: "logistics_02", fullName: "سمية الحسن", roleCode: "logistics" },
    {
      username: "supervisor_ops",
      fullName: "مروان خطيب — مشرف العمليات",
      roleCode: "logistics",
    },
    { username: "finance_01", fullName: "هيفاء المولى", roleCode: "finance" },
  ];

  const staffByUsername = new Map<string, StaffUser>();

  for (const spec of humanSpecs) {
    const row = await prisma.user.upsert({
      where: { username: spec.username },
      update: {
        passwordHash: spec.username === "admin" ? passwordHash : passwordHash,
        fullName: spec.fullName,
        roleCode: spec.roleCode,
        isActive: true,
      },
      create: {
        username: spec.username,
        passwordHash,
        fullName: spec.fullName,
        roleCode: spec.roleCode,
        isActive: true,
        createdById: systemUser.id,
      },
    });
    staffByUsername.set(spec.username, {
      id: row.id,
      username: row.username,
      roleCode: row.roleCode,
    });
  }

  const admin = staffByUsername.get("admin")!;
  const scales = [
    staffByUsername.get("scale_op_01")!,
    staffByUsername.get("scale_op_02")!,
    staffByUsername.get("scale_op_03")!,
  ];
  const loaders = [
    staffByUsername.get("loader_01")!,
    staffByUsername.get("loader_02")!,
  ];
  const logisticsUsers = [
    staffByUsername.get("logistics_01")!,
    staffByUsername.get("logistics_02")!,
    staffByUsername.get("supervisor_ops")!,
  ];

  const pickScale = () => scales[randInt(0, scales.length - 1)]!;
  const pickLoader = () => loaders[randInt(0, loaders.length - 1)]!;
  const pickLogistics = () => logisticsUsers[randInt(0, logisticsUsers.length - 1)]!;

  const uploadsDir = path.join(process.cwd(), "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const seedAttachmentFileName = "seed-full-demo-contract.pdf";
  const seedAttachmentFullPath = path.join(uploadsDir, seedAttachmentFileName);
  const minimalPdf = "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n";
  await writeFile(seedAttachmentFullPath, minimalPdf, "utf8");
  const seedAttachmentPath = `uploads/${seedAttachmentFileName}`;

  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);

  const customerDefs = [
    { name: "شركة الشهباء للحديد والصلب", father: "—", nid: "FULL-DEMO-001", addr: "حلب — المنطقة الصناعية الشمالية" },
    { name: "مجموعة قاسيون للصناعات المعدنية", father: "—", nid: "FULL-DEMO-002", addr: "ريف دمشق — عدرا الصناعية" },
    { name: "منشأة الفيحاء للتجارة", father: "—", nid: "FULL-DEMO-003", addr: "حمص — وادي الدهب" },
    { name: "مؤسسة الوادي للاستيراد والتصدير", father: "—", nid: "FULL-DEMO-004", addr: "دمشق — المزة" },
    { name: "شركة الساحل للنقل الثقيل", father: "—", nid: "FULL-DEMO-005", addr: "طرطوس — الميناء" },
    { name: "مؤسسة الفرات لمواد البناء", father: "—", nid: "FULL-DEMO-006", addr: "دير الزور — الحميدية" },
    { name: "شركة تدمر للإنشاءات الفولاذية", father: "—", nid: "FULL-DEMO-007", addr: "حماة — السلمية" },
    { name: "مجموعة البادية للخدمات اللوجستية", father: "—", nid: "FULL-DEMO-008", addr: "درعا — الصنمين" },
    { name: "شركة المتوسط للصناعات الإنشائية", father: "—", nid: "FULL-DEMO-009", addr: "اللاذقية — الميناء الجنوبي" },
    { name: "مؤسسة غوطة دمشق للحدادة", father: "—", nid: "FULL-DEMO-010", addr: "ريف دمشق — حرستا" },
    { name: "شركة أورينت للمعدات الثقيلة", father: "—", nid: "FULL-DEMO-011", addr: "إدلب — سراقب" },
    { name: "مجموعة الجزيرة للتوريدات الصناعية", father: "—", nid: "FULL-DEMO-012", addr: "الحسكة — الناصرة" },
  ];

  const sizeRows = await prisma.sizeLookup.findMany({
    where: { isActive: true, code: { in: ["12mm", "14mm", "16mm", "20mm"] } },
  });
  const sizeById = new Map(sizeRows.map((s) => [s.id, s]));
  const extraKindSizes = await prisma.sizeLookup.findMany({
    where: { isActive: true, code: { in: ["scrap", "shortbar_1_4m", "shortbar_4_12m"] } },
  });
  const scrapSize = extraKindSizes.find((s) => s.code === "scrap");
  const shortbar14 = extraKindSizes.find((s) => s.code === "shortbar_1_4m");
  const shortbar412 = extraKindSizes.find((s) => s.code === "shortbar_4_12m");
  if (!scrapSize || !shortbar14 || !shortbar412) {
    throw new Error("seed-full-demo: missing scrap or shortbar sizes in size_lookup");
  }

  type CustomerRow = {
    id: number;
    orderNumber: string;
    isActive: boolean;
  };
  const customers: CustomerRow[] = [];

  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const def = customerDefs[i]!;
    const isActive = i < ACTIVE_CUSTOMERS;
    const code = `C-FD-${String(i + 1).padStart(3, "0")}`;
    const contractNumber = `${yy}-${String(70 + i).padStart(2, "0")}`;

    const cust = await prisma.customer.create({
      data: {
        code,
        fullName: def.name,
        fatherName: def.father,
        nationalId: def.nid,
        phonePrimary: `09${randInt(30, 99)}${String(randInt(100000, 999999))}`,
        phoneSecondary: rng() > 0.5 ? `011-${randInt(2000000, 9999999)}` : null,
        companyAddress: def.addr,
        commercialRegistration: rng() > 0.35 ? `CR-FD-${1000 + i}` : null,
        notes: "بيانات تجريبية كاملة — مصنع حديد (عرض فقط).",
        isActive,
        createdById: admin.id,
      },
    });

    if (isActive) {
      await prisma.masterContract.create({
        data: {
          contractNumber,
          customerId: cust.id,
          attachmentPath: seedAttachmentPath,
          status: "active",
          notes: `عقد تجريبي — ${def.name}`,
          createdById: admin.id,
        },
      });
      await prisma.contractAttachment.create({
        data: {
          contractNumber,
          filePath: seedAttachmentPath,
          fileName: seedAttachmentFileName,
          fileSize: Buffer.byteLength(minimalPdf, "utf8"),
          uploadedById: admin.id,
        },
      });

      const orderNumber = `${contractNumber}-001`;
      await prisma.salesOrder.create({
        data: {
          orderNumber,
          contractNumber,
          kind: "REBAR",
          grade: "FIRST",
          settlementMode: "CREDIT",
          paymentDeadlineDays: 28,
          totalQtyTons: new Prisma.Decimal(400 + i * 25),
          toleranceType: "percentage",
          toleranceValue: new Prisma.Decimal(5),
          specialRatioPct: new Prisma.Decimal(10),
          orderDate: new Date(),
          deliveryDate: new Date(Date.now() + 60 * 86400000),
          status: i % 7 === 0 ? "in_progress" : "approved",
          notes: `أمر بيع تجريبي — ${def.name}`,
          createdById: admin.id,
        },
      });

      for (const sz of sizeRows) {
        await prisma.orderItem.create({
          data: {
            orderNumber,
            sizeId: sz.id,
            pricePerTon: new Prisma.Decimal(580 + randInt(0, 40)),
          },
        });
      }

      /** أوامر إضافية لتنويع لوحة المؤشرات (أنواع مواد + حالات) */
      const on2 = `${contractNumber}-002`;
      const patterns = [
        { kind: "SCRAP" as const, status: "approved" as const, tons: 118 },
        { kind: "SHORTBAR_4_12M" as const, status: "completed" as const, tons: 86 },
        { kind: "SHORTBAR_1_4M" as const, status: "in_progress" as const, tons: 64 },
        { kind: "REBAR" as const, status: "approved" as const, tons: 210 },
        { kind: "SCRAP" as const, status: "draft" as const, tons: 55 },
        { kind: "SHORTBAR_4_12M" as const, status: "approved" as const, tons: 142 },
        { kind: "REBAR" as const, status: "completed" as const, tons: 175 },
        { kind: "SHORTBAR_1_4M" as const, status: "approved" as const, tons: 98 },
      ];
      const p2 = patterns[i % patterns.length]!;
      const tons2 = new Prisma.Decimal(p2.tons + randInt(0, 22));
      if (p2.kind === "SCRAP") {
        await prisma.salesOrder.create({
          data: {
            orderNumber: on2,
            contractNumber,
            kind: "SCRAP",
            settlementMode: "PAYMENT_PLAN",
            totalQtyTons: tons2,
            toleranceType: "weight",
            toleranceValue: new Prisma.Decimal(10),
            orderDate: new Date(Date.now() - (12 + i) * 86400000),
            deliveryDate: new Date(Date.now() + (25 + i) * 86400000),
            status: p2.status,
            notes: `خردة — عرض ديمو (${def.name})`,
            createdById: admin.id,
          },
        });
        await prisma.orderItem.create({
          data: {
            orderNumber: on2,
            sizeId: scrapSize.id,
            pricePerTon: new Prisma.Decimal(188 + randInt(0, 25)),
          },
        });
      } else if (p2.kind === "SHORTBAR_4_12M") {
        await prisma.salesOrder.create({
          data: {
            orderNumber: on2,
            contractNumber,
            kind: "SHORTBAR_4_12M",
            settlementMode: i % 2 === 0 ? "CREDIT" : "PAYMENT_PLAN",
            paymentDeadlineDays: i % 2 === 0 ? 30 : null,
            totalQtyTons: tons2,
            toleranceType: "weight",
            toleranceValue: new Prisma.Decimal(8),
            orderDate: new Date(Date.now() - (8 + i) * 86400000),
            deliveryDate: new Date(Date.now() + (40 + i) * 86400000),
            status: p2.status,
            notes: `قصائر 4–12 م — ديمو`,
            createdById: admin.id,
          },
        });
        await prisma.orderItem.create({
          data: {
            orderNumber: on2,
            sizeId: shortbar412.id,
            pricePerTon: new Prisma.Decimal(565 + randInt(0, 30)),
          },
        });
      } else if (p2.kind === "SHORTBAR_1_4M") {
        await prisma.salesOrder.create({
          data: {
            orderNumber: on2,
            contractNumber,
            kind: "SHORTBAR_1_4M",
            settlementMode: "CREDIT",
            paymentDeadlineDays: 21,
            totalQtyTons: tons2,
            toleranceType: "percentage",
            toleranceValue: new Prisma.Decimal(5),
            orderDate: new Date(Date.now() - (5 + i) * 86400000),
            deliveryDate: new Date(Date.now() + (18 + i) * 86400000),
            status: p2.status,
            notes: `قصائر 1–4 م — ديمو`,
            createdById: admin.id,
          },
        });
        await prisma.orderItem.create({
          data: {
            orderNumber: on2,
            sizeId: shortbar14.id,
            pricePerTon: new Prisma.Decimal(578 + randInt(0, 22)),
          },
        });
      } else {
        await prisma.salesOrder.create({
          data: {
            orderNumber: on2,
            contractNumber,
            kind: "REBAR",
            grade: "SECOND",
            settlementMode: "CREDIT",
            paymentDeadlineDays: 28,
            totalQtyTons: tons2,
            toleranceType: "percentage",
            toleranceValue: new Prisma.Decimal(5),
            specialRatioPct: new Prisma.Decimal(8),
            orderDate: new Date(Date.now() - (15 + i) * 86400000),
            deliveryDate: new Date(Date.now() + (50 + i) * 86400000),
            status: p2.status,
            notes: `مبروم نخب ثانٍ — ديمو`,
            createdById: admin.id,
          },
        });
        for (const sz of sizeRows) {
          await prisma.orderItem.create({
            data: {
              orderNumber: on2,
              sizeId: sz.id,
              pricePerTon: new Prisma.Decimal(540 + randInt(0, 35)),
            },
          });
        }
      }

      const on3 = `${contractNumber}-003`;
      const st3 = i % 3 === 0 ? "draft" : i % 3 === 1 ? "cancelled" : "in_progress";
      await prisma.salesOrder.create({
        data: {
          orderNumber: on3,
          contractNumber,
          kind: "REBAR",
          grade: "FIRST",
          settlementMode: "CREDIT",
          paymentDeadlineDays: 28,
          totalQtyTons: new Prisma.Decimal(88 + i * 6),
          toleranceType: "percentage",
          toleranceValue: new Prisma.Decimal(5),
          specialRatioPct: new Prisma.Decimal(10),
          orderDate: new Date(Date.now() - (3 + i) * 86400000),
          deliveryDate: new Date(Date.now() + (12 + i) * 86400000),
          status: st3,
          notes:
            st3 === "cancelled"
              ? "أمر ملغى — لإثراء مخطط حالات الأوامر"
              : "أمر إضافي — ديمو لوحة المؤشرات",
          createdById: admin.id,
        },
      });
      for (const sz of sizeRows) {
        await prisma.orderItem.create({
          data: {
            orderNumber: on3,
            sizeId: sz.id,
            pricePerTon: new Prisma.Decimal(575 + randInt(0, 28)),
          },
        });
      }

      customers.push({ id: cust.id, orderNumber, isActive: true });
    }
  }

  /** عقود إضافية (مغلق / معلّق) لمخطط حالات العقود */
  if (customers.length >= 2) {
    const closedNum = `${yy}-88`;
    await prisma.masterContract.create({
      data: {
        contractNumber: closedNum,
        customerId: customers[0]!.id,
        attachmentPath: seedAttachmentPath,
        status: "closed",
        notes: "عقد سابق — مغلق (بيانات عرض لوحة المؤشرات)",
        createdById: admin.id,
      },
    });
    await prisma.contractAttachment.create({
      data: {
        contractNumber: closedNum,
        filePath: seedAttachmentPath,
        fileName: seedAttachmentFileName,
        fileSize: Buffer.byteLength(minimalPdf, "utf8"),
        uploadedById: admin.id,
      },
    });

    const suspNum = `${yy}-89`;
    await prisma.masterContract.create({
      data: {
        contractNumber: suspNum,
        customerId: customers[1]!.id,
        attachmentPath: seedAttachmentPath,
        status: "suspended",
        notes: "عقد معلّق — بيانات عرض",
        createdById: admin.id,
      },
    });
    await prisma.contractAttachment.create({
      data: {
        contractNumber: suspNum,
        filePath: seedAttachmentPath,
        fileName: seedAttachmentFileName,
        fileSize: Buffer.byteLength(minimalPdf, "utf8"),
        uploadedById: admin.id,
      },
    });
  }

  const driverPool = [
    "محمود الخالد",
    "أنس العلي",
    "بسام حداد",
    "عمار الشريف",
    "زياد النابلسي",
    "ياسر العمري",
    "وليد الصالح",
    "هشام بركات",
    "غسان المصري",
    "فادي حجار",
  ];

  const plates = new Set<string>();
  while (plates.size < TRUCK_COUNT) {
    plates.add(randomPlate());
  }
  const plateList = [...plates];
  shuffleInPlace(STATUS_BLOCKS);

  for (let ti = 0; ti < TRUCK_COUNT; ti++) {
    const status = STATUS_BLOCKS[ti]!;
    const plate = plateList[ti]!;
    const cust = customers[randInt(0, customers.length - 1)]!;
    const registrar = pickLogistics();
    const createdAt = randomFactoryTimestamp();
    const t0 = createdAt;
    const driverName = driverPool[randInt(0, driverPool.length - 1)]!;

    const auditBatch: Array<{
      userId: number;
      action: AuditAction;
      entityType: string;
      entityId: string;
      details: Prisma.InputJsonValue;
      createdAt: Date;
    }> = [];

    const pushAudit = (
      user: StaffUser,
      action: AuditAction,
      entityType: string,
      entityId: string,
      details: Record<string, unknown>,
      at: Date,
    ) => {
      auditBatch.push({
        userId: user.id,
        action,
        entityType,
        entityId,
        details: auditDetail(user.roleCode, details),
        createdAt: at,
      });
    };

    const { tare, gross } = randomTareGross();
    const scaleOp = pickScale();
    const loader = pickLoader();

    let opData: Prisma.TruckOperationCreateInput = {
      customer: { connect: { id: cust.id } },
      plateNumber: plate,
      driverName,
      salesOrder: { connect: { orderNumber: cust.orderNumber } },
      status: "Queued",
      createdAt,
      creator: { connect: { id: registrar.id } },
    };

    if (status === "Cancelled" && rng() < 0.5) {
      const closedEarly = addMinutes(t0, randInt(5, 25));
      opData = {
        ...opData,
        status: "Cancelled",
        cancelReason: "إلغاء بطلب الزبون — عدم جاهزية التحميل",
        closedAt: closedEarly,
        closer: { connect: { id: scaleOp.id } },
      };
      const truck = await prisma.truckOperation.create({ data: opData });
      pushAudit(
        registrar,
        "create",
        "TruckOperation",
        String(truck.id),
        {
          event: "truck_registered",
          previousValue: null,
          newValue: {
            customerId: cust.id,
            plateNumber: plate,
            driverName,
            salesOrderNumber: cust.orderNumber,
          },
        },
        t0,
      );
      pushAudit(
        scaleOp,
        "status_change",
        "TruckOperation",
        String(truck.id),
        {
          event: "session_cancelled",
          previousValue: {
            status: "Queued",
            cancelReason: null,
            closedAt: null,
            closedById: null,
          },
          newValue: {
            status: "Cancelled",
            cancelReason: opData.cancelReason,
            closedAt: closedEarly.toISOString(),
            closedById: scaleOp.id,
          },
        },
        addMinutes(t0, randInt(3, 15)),
      );
      await prisma.auditLog.createMany({ data: auditBatch });
      continue;
    }

    if (status === "Cancelled") {
      const tareTime = addMinutes(t0, randInt(4, 18));
      const sessionTime = addMinutes(tareTime, randInt(5, 14));
      const cancelReason = "تعارض في الطلبية — إعادة تسجيل لاحقاً";
      const closedAt = addMinutes(sessionTime, randInt(8, 30));
      const sz = sizeRows[randInt(0, sizeRows.length - 1)]!;
      const truck = await prisma.truckOperation.create({
        data: {
          customerId: cust.id,
          plateNumber: plate,
          driverName,
          salesOrderNumber: cust.orderNumber,
          status: "OnScale",
          tareWeightKg: new Prisma.Decimal(tare),
          tareTime,
          createdAt,
          createdById: registrar.id,
          sessions: {
            create: {
              sessionNumber: 1,
              sizeId: sz.id,
              bundleCount: randInt(8, 42),
              weightTons: new Prisma.Decimal(
                Number(((gross - tare) / 1000 / randInt(1, 3)).toFixed(3)),
              ),
              createdAt: sessionTime,
            },
          },
        },
      });
      pushAudit(
        registrar,
        "create",
        "TruckOperation",
        String(truck.id),
        {
          event: "truck_registered",
          previousValue: null,
          newValue: {
            customerId: cust.id,
            plateNumber: plate,
            driverName,
            salesOrderNumber: cust.orderNumber,
          },
        },
        t0,
      );
      pushAudit(
        scaleOp,
        "status_change",
        "TruckOperation",
        String(truck.id),
        {
          event: "tare_recorded",
          previousValue: { status: "Queued", tareWeightKg: null },
          newValue: { status: "FirstWeigh", tareWeightKg: tare },
        },
        tareTime,
      );
      const ws = await prisma.weighSession.findFirst({
        where: { truckOperationId: truck.id },
      });
      if (ws) {
        pushAudit(
          loader,
          "create",
          "WeighSession",
          String(ws.id),
          {
            truckId: truck.id,
            sessionNumber: 1,
            weightTons: Number(ws.weightTons),
            sizeId: sz.id,
          },
          sessionTime,
        );
      }
      await prisma.truckOperation.update({
        where: { id: truck.id },
        data: {
          status: "Cancelled",
          cancelReason,
          closedAt,
          closedById: scaleOp.id,
        },
      });
      pushAudit(
        scaleOp,
        "status_change",
        "TruckOperation",
        String(truck.id),
        {
          event: "session_cancelled",
          previousValue: {
            status: "OnScale",
            cancelReason: null,
            closedAt: null,
            closedById: null,
          },
          newValue: {
            status: "Cancelled",
            cancelReason,
            closedAt: closedAt.toISOString(),
            closedById: scaleOp.id,
          },
        },
        closedAt,
      );
      await prisma.auditLog.createMany({ data: auditBatch });
      continue;
    }

    const tareTime = addMinutes(t0, randInt(3, 20));

    if (status === "FirstWeigh") {
      const truck = await prisma.truckOperation.create({
        data: {
          ...opData,
          status: "FirstWeigh",
          tareWeightKg: new Prisma.Decimal(tare),
          tareTime,
        },
      });
      pushAudit(
        registrar,
        "create",
        "TruckOperation",
        String(truck.id),
        {
          event: "truck_registered",
          previousValue: null,
          newValue: {
            customerId: cust.id,
            plateNumber: plate,
            driverName,
            salesOrderNumber: cust.orderNumber,
          },
        },
        t0,
      );
      pushAudit(
        scaleOp,
        "status_change",
        "TruckOperation",
        String(truck.id),
        {
          event: "tare_recorded",
          previousValue: { status: "Queued", tareWeightKg: null },
          newValue: { status: "FirstWeigh", tareWeightKg: tare },
        },
        tareTime,
      );
      await prisma.auditLog.createMany({ data: auditBatch });
      continue;
    }

    let cursor = tareTime;
    const nSessions = randInt(1, 3);
    const bridgeNetTon = (gross - tare) / 1000;
    const share = bridgeNetTon / nSessions;
    const sessionsPayload: Prisma.WeighSessionCreateWithoutTruckOperationInput[] =
      [];

    for (let s = 0; s < nSessions; s++) {
      const sz = sizeRows[randInt(0, sizeRows.length - 1)]!;
      const jitter = 0.92 + rng() * 0.16;
      const tons = Math.max(0.5, share * jitter - s * 0.05);
      cursor = addMinutes(cursor, randInt(5, 15));
      sessionsPayload.push({
        sessionNumber: s + 1,
        size: { connect: { id: sz.id } },
        bundleCount: randInt(6, 48),
        weightTons: new Prisma.Decimal(Number(tons.toFixed(3))),
        createdAt: cursor,
      });
    }

    if (status === "OnScale") {
      const truck = await prisma.truckOperation.create({
        data: {
          ...opData,
          status: "OnScale",
          tareWeightKg: new Prisma.Decimal(tare),
          tareTime,
          sessions: { create: sessionsPayload },
        },
      });
      let st = tareTime;
      pushAudit(
        registrar,
        "create",
        "TruckOperation",
        String(truck.id),
        {
          event: "truck_registered",
          previousValue: null,
          newValue: {
            customerId: cust.id,
            plateNumber: plate,
            driverName,
            salesOrderNumber: cust.orderNumber,
          },
        },
        t0,
      );
      pushAudit(
        scaleOp,
        "status_change",
        "TruckOperation",
        String(truck.id),
        {
          event: "tare_recorded",
          previousValue: { status: "Queued", tareWeightKg: null },
          newValue: { status: "FirstWeigh", tareWeightKg: tare },
        },
        tareTime,
      );
      const createdSessions = await prisma.weighSession.findMany({
        where: { truckOperationId: truck.id },
        orderBy: { sessionNumber: "asc" },
      });
      for (const ws of createdSessions) {
        st = addMinutes(st, randInt(5, 15));
        const sz = sizeById.get(ws.sizeId ?? 0);
        pushAudit(
          loader,
          "create",
          "WeighSession",
          String(ws.id),
          {
            truckId: truck.id,
            sessionNumber: ws.sessionNumber,
            weightTons: Number(ws.weightTons),
            sizeId: ws.sizeId,
            sizeCode: sz?.code,
          },
          ws.createdAt,
        );
      }
      if (rng() > 0.65) {
        const cap = addMinutes(cursor, randInt(2, 8));
        const shot = await prisma.truckPhoto.create({
          data: {
            truckOperationId: truck.id,
            filePath: `uploads/demo-full/truck-${truck.id}-load.jpg`,
            capturedAt: cap,
          },
        });
        pushAudit(
          loader,
          "upload",
          "TruckPhoto",
          String(shot.id),
          { truckId: truck.id, filePath: shot.filePath },
          cap,
        );
      }
      await prisma.auditLog.createMany({ data: auditBatch });
      continue;
    }

    const photoTime = addMinutes(cursor, randInt(2, 10));
    let loadingConfirmedAt = addMinutes(photoTime, randInt(4, 18));
    const reopenStory = (status === "Completed" || rng() < 0.12) && rng() < 0.2;

    if (status === "LoadingComplete" || status === "Completed") {
      const truck = await prisma.truckOperation.create({
        data: {
          ...opData,
          status: "OnScale",
          tareWeightKg: new Prisma.Decimal(tare),
          tareTime,
          sessions: { create: sessionsPayload },
        },
      });
      const loadPhoto = await prisma.truckPhoto.create({
        data: {
          truckOperationId: truck.id,
          filePath: `uploads/demo-full/truck-${truck.id}-load.jpg`,
          capturedAt: photoTime,
        },
      });

      pushAudit(
        registrar,
        "create",
        "TruckOperation",
        String(truck.id),
        {
          event: "truck_registered",
          previousValue: null,
          newValue: {
            customerId: cust.id,
            plateNumber: plate,
            driverName,
            salesOrderNumber: cust.orderNumber,
          },
        },
        t0,
      );
      pushAudit(
        scaleOp,
        "status_change",
        "TruckOperation",
        String(truck.id),
        {
          event: "tare_recorded",
          previousValue: { status: "Queued", tareWeightKg: null },
          newValue: { status: "FirstWeigh", tareWeightKg: tare },
        },
        tareTime,
      );
      const createdSessions = await prisma.weighSession.findMany({
        where: { truckOperationId: truck.id },
        orderBy: { sessionNumber: "asc" },
      });
      let st = tareTime;
      for (const ws of createdSessions) {
        st = addMinutes(st, randInt(5, 15));
        const sz = sizeById.get(ws.sizeId ?? 0);
        pushAudit(
          loader,
          "create",
          "WeighSession",
          String(ws.id),
          {
            truckId: truck.id,
            sessionNumber: ws.sessionNumber,
            weightTons: Number(ws.weightTons),
            sizeId: ws.sizeId,
            sizeCode: sz?.code,
          },
          ws.createdAt,
        );
      }
      pushAudit(
        loader,
        "upload",
        "TruckPhoto",
        String(loadPhoto.id),
        { truckId: truck.id, filePath: loadPhoto.filePath },
        photoTime,
      );

      if (reopenStory) {
        const firstConfirm = loadingConfirmedAt;
        pushAudit(
          loader,
          "status_change",
          "TruckOperation",
          String(truck.id),
          {
            event: "loading_confirmed",
            previousValue: {
              status: "OnScale",
              loadingConfirmedAt: null,
              loaderId: null,
            },
            newValue: {
              status: "LoadingComplete",
              loadingConfirmedAt: firstConfirm.toISOString(),
              loaderId: loader.id,
              sessionCount: nSessions,
              totalInternalTons: bridgeNetTon * (0.95 + rng() * 0.08),
            },
          },
          firstConfirm,
        );
        const reopenAt = addMinutes(firstConfirm, randInt(5, 12));
        pushAudit(
          loader,
          "status_change",
          "TruckOperation",
          String(truck.id),
          {
            event: "session_reopened",
            previousValue: {
              status: "LoadingComplete",
              loadingConfirmedAt: firstConfirm.toISOString(),
              loaderId: loader.id,
            },
            newValue: {
              status: "OnScale",
              loadingConfirmedAt: null,
              loaderId: null,
            },
          },
          reopenAt,
        );
        loadingConfirmedAt = addMinutes(reopenAt, randInt(10, 25));
      }

      pushAudit(
        loader,
        "status_change",
        "TruckOperation",
        String(truck.id),
        {
          event: "loading_confirmed",
          previousValue: {
            status: "OnScale",
            loadingConfirmedAt: null,
            loaderId: null,
          },
          newValue: {
            status: "LoadingComplete",
            loadingConfirmedAt: loadingConfirmedAt.toISOString(),
            loaderId: loader.id,
            sessionCount: nSessions,
            totalInternalTons: bridgeNetTon * (0.94 + rng() * 0.1),
          },
        },
        loadingConfirmedAt,
      );

      await prisma.truckOperation.update({
        where: { id: truck.id },
        data: {
          status: "LoadingComplete",
          loadingConfirmedAt,
          loaderId: loader.id,
        },
      });

      if (status === "LoadingComplete") {
        if (rng() < 0.38) {
          const pickCount = randInt(1, 2);
          const order = shuffleInPlace(sizeRows.map((_, i) => i));
          for (let r = 0; r < pickCount; r++) {
            const sz = sizeRows[order[r]!]!;
            await prisma.truckRequestItem.create({
              data: {
                truckOperationId: truck.id,
                sizeId: sz.id,
                bundleCount: randInt(4, 40),
                requestedTons: new Prisma.Decimal(
                  Number((bridgeNetTon / pickCount).toFixed(3)),
                ),
              },
            });
          }
        }
        await prisma.auditLog.createMany({ data: auditBatch });
        continue;
      }

      const grossTime = addMinutes(loadingConfirmedAt, randInt(8, 40));
      const closedAt = addMinutes(grossTime, randInt(4, 22));

      pushAudit(
        scaleOp,
        "status_change",
        "TruckOperation",
        String(truck.id),
        {
          event: "gross_recorded",
          previousValue: { status: "LoadingComplete", grossWeightKg: null },
          newValue: {
            status: "SecondWeigh",
            grossWeightKg: gross,
            tareWeightKg: tare,
            netWeightKg: gross - tare,
            loaderId: loader.id,
            loadingConfirmedAt: loadingConfirmedAt.toISOString(),
          },
        },
        grossTime,
      );

      pushAudit(
        scaleOp,
        "status_change",
        "TruckOperation",
        String(truck.id),
        {
          from: "SecondWeigh",
          to: "Completed",
          bridgeNetKg: gross - tare,
          internalTotalTons: bridgeNetTon * (0.96 + rng() * 0.06),
          bridgeNetTons: bridgeNetTon,
          discrepancyTons: (rng() - 0.5) * 0.8,
        },
        closedAt,
      );

      await prisma.truckOperation.update({
        where: { id: truck.id },
        data: {
          status: "Completed",
          grossWeightKg: new Prisma.Decimal(gross),
          grossTime,
          closedAt,
          closedById: scaleOp.id,
        },
      });

      await prisma.auditLog.createMany({ data: auditBatch });
      continue;
    }
  }

  /** دفعات موزّعة على آخر ~35 يوماً — تغذية KPI، المخطط الزمني، أعلى الزبائن، وأنواع الدفع */
  const financeUser = staffByUsername.get("finance_01")!;
  const payerCustomers = customers.slice(0, Math.min(8, customers.length));
  const payMethods: Array<"CASH" | "BANK_TRANSFER" | "CHECK"> = [
    "CASH",
    "BANK_TRANSFER",
    "CHECK",
  ];
  for (let p = 0; p < 52; p++) {
    const daysAgo = randInt(0, 34);
    const payDate = new Date();
    payDate.setDate(payDate.getDate() - daysAgo);
    payDate.setHours(randInt(7, 18), randInt(0, 59), 0, 0);
    const rankBias = p % 11;
    const custPick =
      rankBias <= 2
        ? 0
        : rankBias <= 4
          ? 1
          : rankBias <= 6
            ? 2
            : randInt(0, Math.max(0, payerCustomers.length - 1));
    const customerId = payerCustomers[custPick]!.id;
    const bigPayer = custPick <= 2;
    const amount = bigPayer
      ? randInt(95_000, 480_000)
      : randInt(18_000, 110_000);
    await prisma.payment.create({
      data: {
        customerId,
        amount: new Prisma.Decimal(amount),
        method: payMethods[p % payMethods.length]!,
        paymentDate: payDate,
        referenceNumber:
          p % 6 === 0 ? `DMO-${yy}-${String(p + 1).padStart(4, "0")}` : null,
        notes: p % 5 === 0 ? "دفعة تجريبية — عرض لوحة المؤشرات" : null,
        createdById: financeUser.id,
      },
    });
  }

  const auditTotal = await prisma.auditLog.count();
  const sessionTotal = await prisma.weighSession.count();

  console.log(`👤 ${humanSpecs.length} users created`);
  console.log(`🏢 ${CUSTOMER_COUNT} customers created`);
  console.log(`🚚 ${TRUCK_COUNT} truck operations generated`);
  console.log(`⚖️  Weigh sessions created successfully (${sessionTotal} sessions)`);
  console.log(`🧾 Audit logs completed (${auditTotal} rows)`);
  console.log("📊 Factory demo environment ready");
  console.log("");
  console.log(`   تسجيل الدخول (جميع الحسابات): ${DEMO_PLAIN_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
