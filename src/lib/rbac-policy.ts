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
  "scale_operator", // External Scale Operator — موظف القبان الخارجي
]);

/**
 * Preferred home path per operational role when the user cannot access
 * the KPI dashboard at `/`. Used as the *first* candidate only — see
 * `resolveLandingPage`, which also verifies the user can actually open
 * that path. Roles not listed here skip straight to permission-based
 * fallbacks.
 *
 * Keep this list in sync with shop-floor / operational roles.
 */
const ROLE_LANDING_PAGE: Record<string, string> = {
  scale_operator: "/trucks",
  internal_loader: "/trucks",
  // Logistics is an operational role — no dashboard/reports access.
  // Landing at /trucks keeps them on their working surface.
  logistics: "/trucks",
};

/**
 * Permission gates for role-preferred paths and permission-based
 * fallbacks. OR logic: the user needs at least one listed code.
 * Keep in sync with `ROUTE_PERMISSIONS` in `src/middleware.ts`.
 */
const LANDING_PATH_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  "/trucks": ["truck.view_queue", "truck.view_approved"],
  "/scale": ["truck.view_approved", "scale.start"],
  "/stock/production-in": ["stock.production.ton", "stock.production.bundle"],
  "/stock": ["stock.view"],
  "/contracts": ["contract.view"],
  "/sales-orders": ["salesorder.view"],
  "/finance": ["payment.view"],
  "/billet-receipts": ["billet.receipt.view"],
  "/billet-contracts": ["billet.contract.view"],
  "/reports": ["reports.view"],
};

/**
 * Fallback landing paths tried (in order) when the role-preferred path
 * is missing or the user cannot open it. Stock paths are skipped when
 * the stock module is dark-launched off.
 */
const LANDING_FALLBACKS: readonly {
  path: string;
  requiresStockModule?: boolean;
}[] = [
  { path: "/trucks" },
  { path: "/stock/production-in", requiresStockModule: true },
  { path: "/stock", requiresStockModule: true },
  { path: "/scale" },
  { path: "/contracts" },
  { path: "/sales-orders" },
  { path: "/finance" },
  { path: "/billet-receipts" },
  { path: "/billet-contracts" },
  { path: "/reports" },
];

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function toPermissionSet(
  permissions: ReadonlySet<string> | readonly string[],
): ReadonlySet<string> {
  return permissions instanceof Set ? permissions : new Set(permissions);
}

function canOpenLandingPath(
  path: string,
  permissions: ReadonlySet<string>,
): boolean {
  const required = LANDING_PATH_PERMISSIONS[path];
  if (!required || required.length === 0) return false;
  return required.some((code) => permissions.has(code));
}

/**
 * Returns the role-specific preferred landing path if one is configured,
 * or `null` when the role has no mapped home.
 *
 * Prefer `resolveLandingPage` at call sites — it also checks that the
 * user can open the path. This helper remains for role-map inspection
 * and backwards-compatible call sites.
 */
export function getRoleLandingPage(roleCode: string): string | null {
  return ROLE_LANDING_PAGE[roleCode] ?? null;
}

/**
 * Picks a safe post-login / access-denied landing page from the user's
 * *effective* permissions (not role alone).
 *
 * Order:
 *   1. Role-preferred path, if the user can open it
 *   2. `/` when `canAccessDashboard` is true (owner/manager home)
 *   3. First permission-matched operational fallback (stock paths honor the flag)
 *   4. `null` → callers redirect to `/forbidden`
 *
 * `excludePath` prevents redirect loops when the path just denied is
 * also the role-preferred landing.
 */
export function resolveLandingPage(params: {
  roleCode: string;
  permissions: ReadonlySet<string> | readonly string[];
  stockModuleEnabled: boolean;
  excludePath?: string;
}): string | null {
  const permissions = toPermissionSet(params.permissions);
  const excluded = params.excludePath
    ? normalizePath(params.excludePath)
    : null;

  const tryPath = (path: string): string | null => {
    const normalized = normalizePath(path);
    if (excluded && normalized === excluded) return null;
    if (!canOpenLandingPath(normalized, permissions)) return null;
    return normalized;
  };

  const preferred = getRoleLandingPage(params.roleCode);
  if (preferred) {
    const resolved = tryPath(preferred);
    if (resolved) return resolved;
  }

  if (
    canAccessDashboard({ roleCode: params.roleCode, permissions }) &&
    excluded !== "/"
  ) {
    return "/";
  }

  for (const candidate of LANDING_FALLBACKS) {
    if (candidate.requiresStockModule && !params.stockModuleEnabled) {
      continue;
    }
    // Skip re-trying the role-preferred path (already evaluated above).
    if (preferred && normalizePath(candidate.path) === normalizePath(preferred)) {
      continue;
    }
    const resolved = tryPath(candidate.path);
    if (resolved) return resolved;
  }

  return null;
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
