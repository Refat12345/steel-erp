import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { resolveLandingPage } from "@/lib/rbac-policy";
import { isStockModuleEnabled } from "@/config/feature-flags";
import { LOCALE_COOKIE } from "@/i18n/config";
import {
  resolveLocaleFromCookieValue,
  translateError,
} from "@/lib/i18n/server-messages";

/**
 * Layer 1 of the 3-layer RBAC defence.
 *
 * Runs on the Edge runtime, so it cannot hit the database. It is therefore
 * a *coarse* filter that authenticates the request (token present) and does
 * a best-effort permission check against the permissions snapshot in the JWT.
 *
 * Authoritative authorization is performed at:
 *   - Layer 2: route-group layouts calling `requirePagePermission()` (DB-backed)
 *   - Layer 3: API routes calling `getApiSession()` + `hasPermission()` (DB-backed)
 *
 * This file intentionally does NOT trust `token.role` for any decision —
 * permission codes only. Admin JWTs contain every permission code at login,
 * so admin access naturally passes the `permissions.some(...)` check without
 * a role-based bypass.
 */

type RouteRule = {
  pattern: RegExp;
  permissions: string[];
};

const ROUTE_PERMISSIONS: RouteRule[] = [
  { pattern: /^\/contracts\/new$/, permissions: ["contract.create"] },
  { pattern: /^\/contracts(\/.*)?$/, permissions: ["contract.view"] },

  { pattern: /^\/sales-orders\/new$/, permissions: ["salesorder.create"] },
  { pattern: /^\/sales-orders(\/.*)?$/, permissions: ["salesorder.view"] },

  // Billet receiving (purchasing). Specific (/new) before the wildcard parent.
  { pattern: /^\/billet-contracts\/new$/, permissions: ["billet.contract.create"] },
  { pattern: /^\/billet-contracts(\/.*)?$/, permissions: ["billet.contract.view"] },
  { pattern: /^\/billet-receipts(\/.*)?$/, permissions: ["billet.receipt.view"] },

  { pattern: /^\/finance(\/.*)?$/, permissions: ["payment.view"] },

  // Stock (finished-goods warehouse). Specific setup route before the
  // wildcard parent. Location setup requires the stricter manage permission;
  // the map/balances views only need stock.view. API is gated coarsely at
  // stock.view here — mutation handlers enforce stock.location.manage.
  { pattern: /^\/stock\/locations(\/.*)?$/, permissions: ["stock.location.manage"] },
  {
    pattern: /^\/stock\/production-in$/,
    permissions: ["stock.production.ton", "stock.production.bundle"],
  },
  { pattern: /^\/stock\/opening-balance$/, permissions: ["stock.opening_balance"] },
  { pattern: /^\/stock\/transfer$/, permissions: ["stock.transfer"] },
  { pattern: /^\/stock\/adjust$/, permissions: ["stock.adjust"] },
  // The movements ledger has its own permission (separate from the map).
  { pattern: /^\/stock\/movements$/, permissions: ["stock.movements.view"] },
  { pattern: /^\/stock(\/.*)?$/, permissions: ["stock.view"] },
  // Coarse OR gate: GET (ledger) needs movements.view, POST (production-in)
  // needs a production permission — the handler enforces the exact one per
  // method and per counting unit.
  {
    pattern: /^\/api\/stock\/movements$/,
    permissions: ["stock.movements.view", "stock.production.ton", "stock.production.bundle"],
  },
  // Today's production feed: visible to production clerks (either unit) so they
  // can spot duplicate/missing entries even without the full movement-log view.
  {
    pattern: /^\/api\/stock\/production-today$/,
    permissions: ["stock.production.ton", "stock.production.bundle", "stock.movements.view"],
  },
  // Location/balance reads for pickers on production / transfer / adjust —
  // handlers still enforce manage on mutations.
  {
    pattern: /^\/api\/stock\/(balances|locations)(\/.*)?$/,
    permissions: [
      "stock.view",
      "stock.movements.view",
      "stock.production.ton",
      "stock.production.bundle",
      "stock.transfer",
      "stock.adjust",
      "stock.opening_balance",
      "stock.location.manage",
    ],
  },
  { pattern: /^\/api\/stock(\/.*)?$/, permissions: ["stock.view"] },

  // System settings — stricter than the /admin wildcard (specific first).
  { pattern: /^\/admin\/settings$/, permissions: ["settings.edit"] },
  { pattern: /^\/api\/admin\/settings$/, permissions: ["settings.edit"] },
  { pattern: /^\/admin(\/.*)?$/, permissions: ["user.manage"] },

  { pattern: /^\/trucks$/, permissions: ["truck.view_queue", "truck.view_approved"] },

  // Owner-only simplified loaded-trucks view (gated by the daily-trucks
  // report permission so shop-floor roles never see it).
  { pattern: /^\/loaded-trucks$/, permissions: ["report.daily_trucks"] },

  { pattern: /^\/scale\/\d+\/print$/, permissions: ["truck.view_approved", "scale.close"] },
  { pattern: /^\/scale\/\d+$/, permissions: ["truck.view_approved", "scale.start"] },
  { pattern: /^\/scale$/, permissions: ["truck.view_approved", "scale.start"] },

  // Reports section — one canonical gate (`reports.view`). Per-report
  // fine-grained permissions (`report.daily_trucks`, `report.audit`, …)
  // are enforced inside the individual report pages/APIs on top of this.
  { pattern: /^\/reports(\/.*)?$/, permissions: ["reports.view"] },
  { pattern: /^\/api\/reports(\/.*)?$/, permissions: ["reports.view"] },

  // Dashboard / analytics — server page `/` is also guarded server-side
  // because it performs a role-based redirect for restricted roles.
  { pattern: /^\/analytics(\/.*)?$/, permissions: ["dashboard.view"] },
  { pattern: /^\/api\/dashboard(\/.*)?$/, permissions: ["dashboard.view"] },
  { pattern: /^\/api\/analytics(\/.*)?$/, permissions: ["dashboard.view"] },
];

const PUBLIC_PATHS = new Set(["/login", "/forbidden"]);

function isPublicPath(pathname: string): boolean {
  const normalized =
    pathname.endsWith("/") && pathname !== "/"
      ? pathname.slice(0, -1)
      : pathname;
  return PUBLIC_PATHS.has(normalized);
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function isStockPath(pathname: string): boolean {
  return pathname === "/stock" || pathname.startsWith("/stock/") || pathname.startsWith("/api/stock");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const locale = resolveLocaleFromCookieValue(
    req.cookies.get(LOCALE_COOKIE)?.value,
  );

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Dark-launch gate: while the stock module is disabled it must be completely
  // invisible — every stock route behaves as if it does not exist, for all
  // users (admins included). Evaluated from server env at request time so it
  // can be flipped with an env change + reload (no rebuild).
  if (!isStockModuleEnabled() && isStockPath(pathname)) {
    if (isApiPath(pathname)) {
      return NextResponse.json(
        { success: false, error: translateError(locale, "notFoundDefault") },
        { status: 404 },
      );
    }
    return NextResponse.redirect(new URL("/", req.url));
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    if (isApiPath(pathname)) {
      return NextResponse.json(
        { success: false, error: translateError(locale, "unauthorized") },
        { status: 401 },
      );
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const permissions = (token.permissions as string[] | undefined) ?? [];
  // `token.role` is used ONLY as a soft hint for the deny redirect
  // (role-preferred landing, then permission fallbacks). All security
  // decisions use `token.permissions` — never the role.
  const roleCode = (token.role as string | undefined) ?? "";

  for (const rule of ROUTE_PERMISSIONS) {
    if (!rule.pattern.test(pathname)) continue;

    const allowed =
      rule.permissions.length === 0 ||
      rule.permissions.some((p) => permissions.includes(p));

    if (!allowed) {
      if (isApiPath(pathname)) {
        return NextResponse.json(
          { success: false, error: translateError(locale, "forbidden") },
          { status: 403 },
        );
      }
      // Permission-aware landing: role preference only if the user can
      // open it; otherwise first fallback they can access (e.g. stock
      // clerk without truck.* → /stock/...). excludePath prevents loops.
      const landing = resolveLandingPage({
        roleCode,
        permissions,
        stockModuleEnabled: isStockModuleEnabled(),
        excludePath: pathname,
      });
      return NextResponse.redirect(new URL(landing ?? "/forbidden", req.url));
    }
    break;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Exclude:
    //   - Next.js asset paths
    //   - favicon / PWA icons (must be public — browsers fetch before auth)
    //   - /api/auth/*       — NextAuth handles its own session flows
    //   - /api/health       — public liveness probe (PM2 + monitoring)
    //   - /api/maintenance/cleanup-idempotency
    //       This endpoint is invoked by an unauthenticated cron job that
    //       presents `Authorization: Bearer <CLEANUP_SECRET>`. The route
    //       handler itself enforces (a) a constant-time bearer match against
    //       CLEANUP_SECRET, OR (b) an admin session with `user.manage`. So
    //       the endpoint remains protected even though middleware is skipped.
    //       Without this exemption, the bearer-only cron path is rejected
    //       at Layer 1 with 401 before the handler ever runs.
    "/((?!_next/static|_next/image|favicon.ico|apple-icon.png|steeltech-logo.png|api/auth|api/health|api/maintenance/cleanup-idempotency).*)",
  ],
};
