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
  /** English display name (bilingual i18n phase 5). Arabic `displayName` stays authoritative. */
  displayNameEn: string;
}

export interface RbacPermissionDef {
  code: string;
  displayName: string;
  /** English display name (bilingual i18n phase 5). Arabic `displayName` stays authoritative. */
  displayNameEn: string;
  module: string;
}

export const RBAC_ROLES: ReadonlyArray<RbacRoleDef> = [
  { code: "admin", displayName: "المدير العام", displayNameEn: "General Manager" },
  { code: "finance", displayName: "المالية", displayNameEn: "Finance" },
  { code: "logistics", displayName: "اللوجستيك", displayNameEn: "Logistics" },
  { code: "scale_operator", displayName: "موظف القبان الخارجي", displayNameEn: "External Scale Operator" },
  { code: "internal_loader", displayName: "عامل التحميل الداخلي", displayNameEn: "Internal Loader" },
  { code: "manager", displayName: "صاحب المصنع", displayNameEn: "Factory Owner" },
];

export const RBAC_PERMISSIONS: ReadonlyArray<RbacPermissionDef> = [
  // Contracts
  { code: "contract.create", displayName: "إنشاء عقد", displayNameEn: "Create contract", module: "contracts" },
  { code: "contract.edit", displayName: "تعديل عقد", displayNameEn: "Edit contract", module: "contracts" },
  { code: "contract.change_status", displayName: "تغيير حالة عقد", displayNameEn: "Change contract status", module: "contracts" },
  { code: "contract.view", displayName: "عرض العقود", displayNameEn: "View contracts", module: "contracts" },
  // Sales Orders
  { code: "salesorder.create", displayName: "إنشاء أمر بيع", displayNameEn: "Create sales order", module: "sales" },
  { code: "salesorder.edit_draft", displayName: "تعديل مسودة أمر بيع", displayNameEn: "Edit draft sales order", module: "sales" },
  { code: "salesorder.set_price", displayName: "تثبيت الأسعار", displayNameEn: "Set prices", module: "sales" },
  { code: "salesorder.approve", displayName: "اعتماد أمر بيع", displayNameEn: "Approve sales order", module: "sales" },
  { code: "salesorder.edit_approved", displayName: "تعديل بعد الاعتماد", displayNameEn: "Edit after approval", module: "sales" },
  { code: "salesorder.cancel", displayName: "إلغاء أمر بيع", displayNameEn: "Cancel sales order", module: "sales" },
  { code: "salesorder.view", displayName: "عرض أوامر البيع", displayNameEn: "View sales orders", module: "sales" },
  // Trucks / Logistics
  { code: "truck.register", displayName: "تسجيل شاحنة", displayNameEn: "Register truck", module: "logistics" },
  { code: "truck.edit_queued", displayName: "تعديل شاحنة بالطابور", displayNameEn: "Edit queued truck", module: "logistics" },
  {
    code: "truck.edit_approved",
    displayName: "تعديل بيانات الشاحنة المعتمدة",
    displayNameEn: "Edit approved truck details",
    module: "logistics",
  },
  {
    code: "truck.edit_request_items",
    displayName: "تعديل تفاصيل طلبية الشاحنة",
    displayNameEn: "Edit truck request details",
    module: "logistics",
  },
  { code: "truck.view_queue", displayName: "عرض الطابور", displayNameEn: "View queue", module: "logistics" },
  { code: "truck.view_approved", displayName: "عرض المعتمدة فقط", displayNameEn: "View approved only", module: "logistics" },
  {
    code: "truck.view_history",
    displayName: "تصفح أرشيف الشاحنات بالتاريخ",
    displayNameEn: "Browse truck history by date",
    module: "logistics",
  },
  // Finance
  { code: "payment.create", displayName: "إدخال دفعة مالية", displayNameEn: "Record payment", module: "finance" },
  { code: "payment.view", displayName: "عرض الدفعات", displayNameEn: "View payments", module: "finance" },
  { code: "creditlimit.set", displayName: "محجوز — غير مستخدم في v1", displayNameEn: "Reserved — unused in v1", module: "finance" },
  { code: "buffer.grant", displayName: "منح Buffer", displayNameEn: "Grant buffer", module: "finance" },
  { code: "specialratio.override", displayName: "موافقة تجاوز النسبة الخاصة", displayNameEn: "Approve special-ratio override", module: "finance" },
  // Scale
  { code: "scale.start", displayName: "بدء عملية وزن", displayNameEn: "Start weighing operation", module: "scale" },
  { code: "scale.enter_tare", displayName: "إدخال وزن الفارغ", displayNameEn: "Enter tare weight", module: "scale" },
  { code: "scale.enter_gross", displayName: "إدخال وزن المحمّل", displayNameEn: "Enter gross weight", module: "scale" },
  { code: "scale.enter_session", displayName: "إدخال وزنة داخلية", displayNameEn: "Enter internal weigh", module: "scale" },
  { code: "scale.edit_session", displayName: "تعديل وزنة", displayNameEn: "Edit weigh session", module: "scale" },
  { code: "scale.delete_session", displayName: "حذف وزنة داخلية", displayNameEn: "Delete internal weigh", module: "scale" },
  { code: "scale.upload_photo", displayName: "رفع صورة", displayNameEn: "Upload photo", module: "scale" },
  { code: "scale.loading_complete", displayName: "تأكيد اكتمال التحميل", displayNameEn: "Confirm loading complete", module: "scale" },
  { code: "scale.reopen_before_gross", displayName: "إعادة فتح التحميل قبل الجروس", displayNameEn: "Reopen loading before gross", module: "scale" },
  { code: "scale.close", displayName: "إغلاق نهائي وطباعة كرت", displayNameEn: "Final close and print card", module: "scale" },
  { code: "scale.cancel", displayName: "إلغاء عملية مع سبب", displayNameEn: "Cancel operation with reason", module: "scale" },
  {
    code: "scale.correct_completed",
    displayName: "تصحيح إداري لشاحنة مكتملة",
    displayNameEn: "Administrative correction of completed truck",
    module: "scale",
  },
  // Admin
  { code: "forcepass.execute", displayName: "تمرير إجباري", displayNameEn: "Force pass", module: "admin" },
  { code: "user.manage", displayName: "إدارة المستخدمين", displayNameEn: "Manage users", module: "admin" },
  { code: "user.set_permissions", displayName: "تعديل صلاحيات المستخدمين", displayNameEn: "Edit user permissions", module: "admin" },
  { code: "settings.edit", displayName: "تعديل الإعدادات العامة", displayNameEn: "Edit general settings", module: "admin" },
  // Purchasing — Billet Receiving (supplier contracts + inbound receipts)
  { code: "billet.contract.view", displayName: "عرض عقود الموردين", displayNameEn: "View supplier contracts", module: "purchasing" },
  { code: "billet.contract.create", displayName: "إنشاء عقد مورّد", displayNameEn: "Create supplier contract", module: "purchasing" },
  { code: "billet.contract.edit", displayName: "تعديل عقد مورّد", displayNameEn: "Edit supplier contract", module: "purchasing" },
  {
    code: "billet.contract.prior_withdrawal",
    displayName: "تسجيل سحب سابق على عقد مورّد",
    displayNameEn: "Record prior withdrawal on supplier contract",
    module: "purchasing",
  },
  { code: "billet.contract.change_status", displayName: "تغيير حالة عقد مورّد", displayNameEn: "Change supplier contract status", module: "purchasing" },
  { code: "billet.contract.upload", displayName: "رفع مرفقات عقد مورّد", displayNameEn: "Upload supplier contract attachments", module: "purchasing" },
  { code: "billet.receipt.view", displayName: "عرض سجلات استلام البيلت", displayNameEn: "View billet receipts", module: "purchasing" },
  {
    code: "billet.receipt.view_history",
    displayName: "تصفح أرشيف استلام البيلت بالتاريخ",
    displayNameEn: "Browse billet receipt history by date",
    module: "purchasing",
  },
  { code: "billet.receipt.register", displayName: "تسجيل شاحنة بيلت مسبقاً", displayNameEn: "Pre-register billet truck", module: "purchasing" },
  { code: "billet.receipt.weigh", displayName: "إدخال وزن البيلت المحمّل", displayNameEn: "Enter loaded billet weight", module: "purchasing" },
  { code: "billet.receipt.unload", displayName: "تفريغ البيلت (صورة + عدّ + مرتجع)", displayNameEn: "Unload billet (photo + count + rejects)", module: "purchasing" },
  { code: "billet.receipt.close", displayName: "إغلاق استلام البيلت (وزن فارغ)", displayNameEn: "Close billet receipt (empty weight)", module: "purchasing" },
  { code: "billet.receipt.upload", displayName: "رفع مرفقات استلام البيلت", displayNameEn: "Upload billet receipt attachments", module: "purchasing" },
  { code: "billet.receipt.cancel", displayName: "إلغاء استلام بيلت", displayNameEn: "Cancel billet receipt", module: "purchasing" },
  // Stock (Finished-Goods Warehouse)
  { code: "stock.view", displayName: "عرض المخزون وخريطة المستودع", displayNameEn: "View stock and warehouse map", module: "stock" },
  // Add-on permission on top of `stock.view` (same pattern as
  // `dashboard.ops.view`): grants access to the full movements ledger
  // (/stock/movements) — every adjustment, transfer, and truck deduction with
  // who/when/why. Holders are expected to also hold `stock.view`.
  {
    code: "stock.movements.view",
    displayName: "عرض سجل حركات المخزون",
    displayNameEn: "View stock movements ledger",
    module: "stock",
  },
  {
    code: "stock.location.manage",
    displayName: "إدارة مواقع المخزون (إضافة/تعديل/إيقاف)",
    displayNameEn: "Manage stock locations (add/edit/disable)",
    module: "stock",
  },
  // Mark an occupied first-grade bay as B500B from the live map.
  // Unassigned to role defaults — grant per user from the permission matrix.
  {
    code: "stock.classification.mark",
    displayName: "تمييز صنف الرك (B500B)",
    displayNameEn: "Mark bay steel classification (B500B)",
    module: "stock",
  },
  // Production entry is split across two roles by counting unit: one records
  // tonnage (مبروم + قصائر), another counts bundles (مبروم). Rebar sites track
  // both in parallel; short-bar tracks tons only.
  {
    code: "stock.production.ton",
    displayName: "تسجيل دخول إنتاج بالطن",
    displayNameEn: "Record production entry in tons",
    module: "stock",
  },
  {
    code: "stock.production.bundle",
    displayName: "تسجيل دخول إنتاج بالربطات",
    displayNameEn: "Record production entry in bundles",
    module: "stock",
  },
  // Correct a production-in row (qty and/or bay). Unassigned to role defaults —
  // grant per user from the permission matrix.
  {
    code: "stock.production.correct",
    displayName: "تصحيح دخول إنتاج (كمية / موقع)",
    displayNameEn: "Correct production entry (quantity / location)",
    module: "stock",
  },
  { code: "stock.transfer", displayName: "ترحيل مخزون بين المواقع", displayNameEn: "Transfer stock between locations", module: "stock" },
  // Opening-balance is superseded by stock.adjust (kept wired, unassigned).
  {
    code: "stock.opening_balance",
    displayName: "إدخال الرصيد الافتتاحي — موقوف حالياً",
    displayNameEn: "Enter opening balance — currently disabled",
    module: "stock",
  },
  { code: "stock.adjust", displayName: "تصحيح جرد المخزون", displayNameEn: "Adjust stock inventory", module: "stock" },
  // Reports
  { code: "reports.view", displayName: "الوصول إلى قسم التقارير", displayNameEn: "Access reports section", module: "reports" },
  { code: "report.daily_trucks", displayName: "تقرير شاحنات يومي", displayNameEn: "Daily trucks report", module: "reports" },
  {
    code: "report.daily_trucks.sensitive_tonnage",
    displayName: "عرض الداخلي والفرق في تقرير الشاحنات",
    displayNameEn: "View internal and difference in trucks report",
    module: "reports",
  },
  { code: "report.customer_balance", displayName: "تقرير رصيد زبون", displayNameEn: "Customer balance report", module: "reports" },
  { code: "report.salesorder_status", displayName: "تقرير حالة أمر بيع", displayNameEn: "Sales order status report", module: "reports" },
  { code: "report.audit", displayName: "تقرير التدقيق", displayNameEn: "Audit report", module: "reports" },
  // Analytics / Dashboard
  { code: "dashboard.view", displayName: "عرض لوحة المؤشرات والإحصاءات", displayNameEn: "View dashboard and statistics", module: "analytics" },
  // Stricter add-on permission: when present in addition to `dashboard.view`,
  // the dashboard payload is expanded with operationally sensitive sections
  // (live fleet status, stuck trucks, cycle-time averages, cancellation %).
  // Intended for the General Manager (`admin`). Withheld from the Owner
  // (`manager`) so they see a calmer "results only" view of the same page.
  {
    code: "dashboard.ops.view",
    displayName: "عرض المؤشرات التشغيلية الحساسة",
    displayNameEn: "View sensitive operational metrics",
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
    "truck.edit_request_items",
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
    "truck.view_history",
    "payment.view",
    "reports.view",
    "report.daily_trucks",
    "report.customer_balance",
    "report.salesorder_status",
    "report.audit",
    // Billet receiving: owner views supplier contracts and inbound receipts.
    "billet.contract.view",
    "billet.receipt.view",
    "billet.receipt.view_history",
    // Stock (dark-launched): owner will see the yard map/balances (read-only)
    // at release. `stock.view` is NOT a default while STOCK_MODULE_ENABLED is
    // off, and the movements ledger (`stock.movements.view`) is never a
    // default — grant per user when management decides who audits the ledger.
  ],
};
