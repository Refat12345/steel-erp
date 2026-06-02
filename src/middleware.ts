import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { getRoleLandingPage } from "@/lib/rbac-policy";

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

  { pattern: /^\/finance(\/.*)?$/, permissions: ["payment.view"] },

  { pattern: /^\/admin(\/.*)?$/, permissions: ["user.manage"] },

  { pattern: /^\/trucks$/, permissions: ["truck.view_queue", "truck.view_approved"] },

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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    if (isApiPath(pathname)) {
      return NextResponse.json(
        { success: false, error: "غير مصرح بالدخول" },
        { status: 401 },
      );
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const permissions = (token.permissions as string[] | undefined) ?? [];
  // `token.role` is used ONLY to pick a friendly redirect destination on
  // deny (shop-floor roles land on /trucks instead of /forbidden). All
  // security decisions above use `token.permissions` — never the role.
  const roleCode = (token.role as string | undefined) ?? "";

  for (const rule of ROUTE_PERMISSIONS) {
    if (!rule.pattern.test(pathname)) continue;

    const allowed =
      rule.permissions.length === 0 ||
      rule.permissions.some((p) => permissions.includes(p));

    if (!allowed) {
      if (isApiPath(pathname)) {
        return NextResponse.json(
          { success: false, error: "لا تملك صلاحية لهذه العملية" },
          { status: 403 },
        );
      }
      const landing = getRoleLandingPage(roleCode);
      // Avoid a redirect loop if the role's landing page is the very
      // path that was just denied (shouldn't happen, but defensive).
      const destination =
        landing && landing !== pathname ? landing : "/forbidden";
      return NextResponse.redirect(new URL(destination, req.url));
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
