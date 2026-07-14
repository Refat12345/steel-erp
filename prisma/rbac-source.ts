/**
 * RBAC source of truth — roles, permissions, and role-default-permission map.
 *
 * Imported by:
 *   - `prisma/seed.ts` (full local seed, includes demo data)
 *   - `scripts/sync-rbac.ts` (production-safe, RBAC-only sync)
 *
 * DO NOT import any prisma/demo/business logic from this file. It must stay a
 * pure data module so it can be safely required from any context (CI, prod,
 * tests) without side effects.
 *
 * Conventions:
 *   - `code` is the stable identifier referenced from middleware, page guards,
 *     API guards, and the sidebar. Treat it as a public contract — renaming a
 *     permission code is a breaking change that must ship with a Prisma
 *     migration to update existing rows.
 *   - `displayName` and `module` are presentation/grouping fields and can
 *     change freely (the sync script will apply them on next run).
 */

export interface RbacRoleDef {
  code: string;
  displayName: string;
}

export interface RbacPermissionDef {
  code: string;
  displayName: string;
  module: string;
}

export const RBAC_ROLES: ReadonlyArray<RbacRoleDef> = [
  { code: "admin", displayName: "المدير العام" },
  { code: "finance", displayName: "المالية" },
  { code: "logistics", displayName: "اللوجستيك" },
  { code: "scale_operator", displayName: "عامل القبان الخارجي" },
  { code: "internal_loader", displayName: "عامل التحميل الداخلي" },
  { code: "manager", displayName: "صاحب المصنع" },
];

export const RBAC_PERMISSIONS: ReadonlyArray<RbacPermissionDef> = [
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
  { code: "truck.edit_approved", displayName: "تعديل طلبية شاحنة معتمدة", module: "logistics" },
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
  { code: "scale.delete_session", displayName: "حذف وزنة داخلية", module: "scale" },
  { code: "scale.upload_photo", displayName: "رفع صورة", module: "scale" },
  { code: "scale.loading_complete", displayName: "تأكيد اكتمال التحميل", module: "scale" },
  { code: "scale.reopen_before_gross", displayName: "إعادة فتح التحميل قبل الجروس", module: "scale" },
  { code: "scale.close", displayName: "إغلاق نهائي وطباعة كرت", module: "scale" },
  { code: "scale.cancel", displayName: "إلغاء عملية مع سبب", module: "scale" },
  {
    code: "scale.correct_completed",
    displayName: "تصحيح إداري لشاحنة مكتملة",
    module: "scale",
  },
  // Admin
  { code: "forcepass.execute", displayName: "تمرير إجباري", module: "admin" },
  { code: "user.manage", displayName: "إدارة المستخدمين", module: "admin" },
  { code: "user.set_permissions", displayName: "تعديل صلاحيات المستخدمين", module: "admin" },
  { code: "settings.edit", displayName: "تعديل الإعدادات العامة", module: "admin" },
  // Purchasing — Billet Receiving (supplier contracts + inbound receipts)
  { code: "billet.contract.view", displayName: "عرض عقود الموردين", module: "purchasing" },
  { code: "billet.contract.create", displayName: "إنشاء عقد مورّد", module: "purchasing" },
  { code: "billet.contract.edit", displayName: "تعديل عقد مورّد", module: "purchasing" },
  {
    code: "billet.contract.prior_withdrawal",
    displayName: "تسجيل سحب سابق على عقد مورّد",
    module: "purchasing",
  },
  { code: "billet.contract.change_status", displayName: "تغيير حالة عقد مورّد", module: "purchasing" },
  { code: "billet.contract.upload", displayName: "رفع مرفقات عقد مورّد", module: "purchasing" },
  { code: "billet.receipt.view", displayName: "عرض سجلات استلام البيلت", module: "purchasing" },
  { code: "billet.receipt.register", displayName: "تسجيل شاحنة بيلت مسبقاً", module: "purchasing" },
  { code: "billet.receipt.weigh", displayName: "إدخال وزن البيلت المحمّل", module: "purchasing" },
  { code: "billet.receipt.unload", displayName: "تفريغ البيلت (صورة + عدّ + مرتجع)", module: "purchasing" },
  { code: "billet.receipt.close", displayName: "إغلاق استلام البيلت (وزن فارغ)", module: "purchasing" },
  { code: "billet.receipt.upload", displayName: "رفع مرفقات استلام البيلت", module: "purchasing" },
  { code: "billet.receipt.cancel", displayName: "إلغاء استلام بيلت", module: "purchasing" },
  // Stock (Finished-Goods Warehouse)
  { code: "stock.view", displayName: "عرض المخزون وخريطة المستودع", module: "stock" },
  // Add-on permission on top of `stock.view` (same pattern as
  // `dashboard.ops.view`): grants access to the full movements ledger
  // (/stock/movements) — every adjustment, transfer, and truck deduction with
  // who/when/why. Holders are expected to also hold `stock.view`.
  {
    code: "stock.movements.view",
    displayName: "عرض سجل حركات المخزون",
    module: "stock",
  },
  {
    code: "stock.location.manage",
    displayName: "إدارة مواقع المخزون (إضافة/تعديل/إيقاف)",
    module: "stock",
  },
  // Production entry is split across two roles by counting unit: one records
  // tonnage (مبروم + قصائر), another counts bundles (مبروم). Rebar sites track
  // both in parallel; short-bar tracks tons only.
  {
    code: "stock.production.ton",
    displayName: "تسجيل دخول إنتاج بالطن",
    module: "stock",
  },
  {
    code: "stock.production.bundle",
    displayName: "تسجيل دخول إنتاج بالربطات",
    module: "stock",
  },
  { code: "stock.transfer", displayName: "ترحيل مخزون بين المواقع", module: "stock" },
  // Opening-balance is superseded by stock.adjust (kept wired, unassigned).
  {
    code: "stock.opening_balance",
    displayName: "إدخال الرصيد الافتتاحي — موقوف حالياً",
    module: "stock",
  },
  { code: "stock.adjust", displayName: "تصحيح جرد المخزون", module: "stock" },
  // Reports
  { code: "reports.view", displayName: "الوصول إلى قسم التقارير", module: "reports" },
  { code: "report.daily_trucks", displayName: "تقرير شاحنات يومي", module: "reports" },
  {
    code: "report.daily_trucks.sensitive_tonnage",
    displayName: "عرض الداخلي والفرق في تقرير الشاحنات",
    module: "reports",
  },
  { code: "report.customer_balance", displayName: "تقرير رصيد زبون", module: "reports" },
  { code: "report.salesorder_status", displayName: "تقرير حالة أمر بيع", module: "reports" },
  { code: "report.audit", displayName: "تقرير التدقيق", module: "reports" },
  // Analytics / Dashboard
  { code: "dashboard.view", displayName: "عرض لوحة المؤشرات والإحصاءات", module: "analytics" },
  // Stricter add-on permission: when present in addition to `dashboard.view`,
  // the dashboard payload is expanded with operationally sensitive sections
  // (live fleet status, stuck trucks, cycle-time averages, cancellation %).
  // Intended for the General Manager (`admin`). Withheld from the Owner
  // (`manager`) so they see a calmer "results only" view of the same page.
  {
    code: "dashboard.ops.view",
    displayName: "عرض المؤشرات التشغيلية الحساسة",
    module: "analytics",
  },
];

/**
 * Role → default permission codes. The sync script (and seed) upsert this map
 * exactly: any mapping in DB that isn't in this object for a given role is
 * considered stale and gets removed (with `--delete-stale` for the prod sync
 * script). Roles not listed here keep whatever mappings they have — only
 * mappings for listed roles are reconciled.
 *
 * Note: `admin` is intentionally absent. The admin role's permissions are
 * resolved at runtime as "all permissions" by `lib/auth` / `lib/page-auth`
 * regardless of the role_default_permissions table, so seeding rows for it
 * would be misleading and add work to every sync.
 */
export const RBAC_ROLE_PERMISSIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
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
    "billet.contract.view",
    "billet.contract.prior_withdrawal",
    "reports.view",
    "report.customer_balance",
    "report.salesorder_status",
    "report.audit",
    "dashboard.view",
  ],
  // `logistics` is an OPERATIONAL role. It MUST NOT receive any
  // analytics or reports permissions — no `dashboard.view`, no
  // `reports.view`, no per-report codes. Requests to /, /reports,
  // /analytics and their APIs are denied at every layer (middleware,
  // page guards, API guards, sidebar).
  logistics: [
    "contract.create",
    "contract.edit",
    "contract.view",
    "salesorder.create",
    "salesorder.edit_draft",
    "salesorder.view",
    "truck.register",
    "truck.edit_queued",
    "truck.edit_approved",
    "truck.view_queue",
    // Billet receiving: logistics pre-registers inbound trucks. Contract
    // choices are loaded through a receipt-registration-only endpoint.
    "billet.receipt.view",
    "billet.receipt.register",
    // Stock (dark-launched): `stock.view` is intentionally NOT a default while
    // STOCK_MODULE_ENABLED is off, so running `rbac:sync` on production never
    // surfaces the unreleased module. Re-add it here (and to the other roles
    // below) as part of the stock-module release, not before.
  ],
  scale_operator: [
    "truck.view_approved",
    "scale.start",
    "scale.enter_tare",
    "scale.enter_gross",
    "scale.close",
    "scale.cancel",
    // Billet receiving: external scale records loaded/empty weights and closes.
    "billet.receipt.view",
    "billet.receipt.weigh",
    "billet.receipt.close",
    "billet.receipt.cancel",
  ],
  internal_loader: [
    "truck.view_approved",
    "scale.enter_session",
    "scale.edit_session",
    "scale.delete_session",
    "scale.upload_photo",
    "scale.loading_complete",
    "scale.reopen_before_gross",
    // Billet receiving: internal loader handles unloading (photo + count + reject).
    "billet.receipt.view",
    "billet.receipt.unload",
    "billet.receipt.upload",
    // Stock (dark-launched): the loader needs `stock.view` to pick a source
    // location in the weigh dialog, but only once the module is released. Not
    // a default while STOCK_MODULE_ENABLED is off — grant at release time.
  ],
  // Read-only "owner / general manager" role. Sees every operational
  // surface (dashboard, contracts, sales orders, trucks queue, finance,
  // reports, audit) but holds NO mutation/state-change permission and
  // NO admin permission. Achieves "view everything, change nothing"
  // without any source-code change in module guards because every
  // server gate keys off permission codes, not role names.
  manager: [
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
    // Billet receiving: owner views supplier contracts and inbound receipts.
    "billet.contract.view",
    "billet.receipt.view",
    // Stock (dark-launched): owner will see the yard map/balances (read-only)
    // at release. `stock.view` is NOT a default while STOCK_MODULE_ENABLED is
    // off, and the movements ledger (`stock.movements.view`) is never a
    // default — grant per user when management decides who audits the ledger.
  ],
};
