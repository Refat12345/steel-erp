/**
 * ─── RBAC Policy Rules ────────────────────────────────────────────────
 *
 * Hardcoded access rules that are stricter than permission codes alone.
 *
 * Permission codes are the normal extensible gate (admin can grant or
 * revoke them per user via `UserPermissionOverride`). Some access rules
 * must be enforceable even against an accidental or malicious permission
 * grant — those live here in source code.
 *
 * The classic example is the external scale worker (`scale_operator`):
 * they are physically outside the company network perimeter and must
 * NEVER see analytics, KPIs, financial totals, payment timelines or
 * top-customer rankings. Even if an admin ticked `dashboard.view` on
 * their user override, these rules would still deny.
 * ─────────────────────────────────────────────────────────────────────
 */

/** Canonical permission gating the KPI dashboard home page + API. */
export const DASHBOARD_PERMISSION = "dashboard.view";

/**
 * Canonical permission gating the entire `/reports` section (and any
 * future `/api/reports/*` endpoints). Individual `report.*` codes
 * gate specific report types on top of this high-level gate.
 */
export const REPORTS_PERMISSION = "reports.view";

/**
 * Roles that are hardcoded-denied from every analytics / KPI / metrics
 * surface (dashboard, charts, aggregate APIs, reports overview).
 *
 * Membership in this set cannot be overridden by granting permissions.
 * Edits require a code change (and therefore code review).
 */
export const ANALYTICS_RESTRICTED_ROLES: ReadonlySet<string> = new Set([
  "scale_operator", // External Scale Worker — عامل القبان الخارجي
]);

/**
 * Where to send a user that cannot access the KPI dashboard at `/`
 * (either because they are on the analytics denylist, or because
 * they simply lack `dashboard.view`). Roles not listed here fall
 * back to `/forbidden`.
 *
 * Keep this list in sync with the shop-floor / operational roles so
 * that login never ends on a dead-end `/forbidden` page for a
 * legitimate worker.
 */
const ROLE_LANDING_PAGE: Record<string, string> = {
  scale_operator: "/trucks",
  internal_loader: "/trucks",
  // Logistics is an operational role — no dashboard/reports access.
  // Landing at /trucks keeps them on their working surface.
  logistics: "/trucks",
};

/**
 * Returns the role-specific landing path if one is configured, or
 * `null` when the role has no mapped home. Callers decide how to
 * handle a `null` (typically by redirecting to `/forbidden`).
 */
export function getRoleLandingPage(roleCode: string): string | null {
  return ROLE_LANDING_PAGE[roleCode] ?? null;
}

export function isAnalyticsRestrictedRole(roleCode: string): boolean {
  return ANALYTICS_RESTRICTED_ROLES.has(roleCode);
}

/**
 * Authoritative server-side check. Both conditions must hold:
 *   1. Role is NOT on the analytics denylist (hardcoded).
 *   2. User has the `dashboard.view` permission code.
 *
 * Use this wherever dashboard/KPI data is gated — page guards, API
 * routes, server components. Never bypass with a role === "admin"
 * check: admin users already receive every permission code through
 * `resolveUserAuth`, so they pass this gate the same way every other
 * user does.
 */
export function canAccessDashboard(params: {
  roleCode: string;
  permissions: ReadonlySet<string> | Set<string>;
}): boolean {
  if (isAnalyticsRestrictedRole(params.roleCode)) return false;
  return params.permissions.has(DASHBOARD_PERMISSION);
}

/** Arabic labels for permission module group headers in the admin UI. */
export const PERMISSION_MODULE_LABELS: Readonly<Record<string, string>> = {
  contracts: "العقود",
  sales: "أوامر البيع",
  logistics: "اللوجستيك والشاحنات",
  finance: "المالية",
  scale: "القبان والتحميل",
  admin: "الإدارة",
  reports: "التقارير",
  analytics: "لوحة المؤشرات",
};

/**
 * Phase 1: non-admin actors with `user.set_permissions` may only edit
 * permissions in modules tied to their operational department.
 * `admin` role bypasses this map entirely.
 */
export const ROLE_EDITABLE_PERMISSION_MODULES: Readonly<
  Record<string, readonly string[]>
> = {
  finance: ["finance"],
  logistics: ["contracts", "sales", "logistics"],
  scale_operator: ["scale", "logistics"],
  internal_loader: ["scale", "logistics"],
  manager: [
    "contracts",
    "sales",
    "logistics",
    "finance",
    "scale",
    "reports",
    "analytics",
  ],
};

const ANALYTICS_PERMISSION_PREFIXES = ["dashboard.", "reports.", "report."] as const;

const RESERVED_UNUSED_PERMISSIONS = new Set(["creditlimit.set"]);

const SENSITIVE_PERMISSIONS = new Set([
  "forcepass.execute",
  "user.manage",
  "user.set_permissions",
  "settings.edit",
]);

export function getPermissionModuleLabel(module: string): string {
  return PERMISSION_MODULE_LABELS[module] ?? module;
}

/** `null` means all modules (admin actor). */
export function getEditableModulesForActor(
  actorRoleCode: string,
): ReadonlySet<string> | null {
  if (actorRoleCode === "admin") return null;
  const modules = ROLE_EDITABLE_PERMISSION_MODULES[actorRoleCode];
  return modules ? new Set(modules) : new Set();
}

export function isSensitivePermission(code: string): boolean {
  return SENSITIVE_PERMISSIONS.has(code);
}

export function isReservedUnusedPermission(code: string): boolean {
  return RESERVED_UNUSED_PERMISSIONS.has(code);
}

function isAnalyticsPermissionCode(code: string): boolean {
  return ANALYTICS_PERMISSION_PREFIXES.some(
    (prefix) => code === prefix || code.startsWith(prefix),
  );
}

/**
 * Non-blocking warnings returned to the admin UI after saving overrides.
 */
export function collectPermissionOverrideWarnings(params: {
  targetRoleCode: string;
  effectiveEnabled: Map<string, boolean>;
}): string[] {
  const warnings: string[] = [];

  if (!isAnalyticsRestrictedRole(params.targetRoleCode)) {
    return warnings;
  }

  for (const [code, enabled] of params.effectiveEnabled) {
    if (!enabled) continue;
    if (!isAnalyticsPermissionCode(code)) continue;
    warnings.push(
      `الصلاحية «${code}» مفعّلة لكن دور «${params.targetRoleCode}» محظور من التحليلات والتقارير في النظام ولن يحصل على وصول فعلي.`,
    );
  }

  for (const [code, enabled] of params.effectiveEnabled) {
    if (!enabled) continue;
    if (code === "dashboard.ops.view" && params.targetRoleCode !== "admin") {
      warnings.push(
        "صلاحية المؤشرات التشغيلية الحساسة مخصصة عادةً للمدير العام فقط.",
      );
    }
    if (isReservedUnusedPermission(code)) {
      warnings.push(`الصلاحية «${code}» محجوزة وغير مستخدمة في الإصدار الحالي.`);
    }
  }

  return warnings;
}
