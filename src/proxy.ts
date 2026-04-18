import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

type RouteRule = {
  pattern: RegExp;
  permissions: string[];
};

/**
 * Route-to-permission mapping. Order matters: first match wins.
 * permissions uses OR logic: user needs at least one of the listed permissions.
 */
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

  { pattern: /^\/reports(\/.*)?$/, permissions: ["report.daily_trucks", "report.customer_balance", "report.salesorder_status", "report.audit"] },
];

function checkPermission(
  role: string,
  userPermissions: string[],
  requiredPermissions: string[],
): boolean {
  if (role === "admin") return true;
  if (requiredPermissions.length === 0) return true;
  return requiredPermissions.some((p) => userPermissions.includes(p));
}

const PUBLIC_PATHS = new Set(["/login", "/forbidden"]);

function isPublicPath(pathname: string): boolean {
  const normalized = pathname.endsWith("/") && pathname !== "/"
    ? pathname.slice(0, -1)
    : pathname;
  return PUBLIC_PATHS.has(normalized);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "غير مصرح بالدخول" },
        { status: 401 },
      );
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const role = (token.role as string) || "";
  const permissions = (token.permissions as string[]) || [];

  for (const rule of ROUTE_PERMISSIONS) {
    if (rule.pattern.test(pathname)) {
      if (!checkPermission(role, permissions, rule.permissions)) {
        if (pathname.startsWith("/api/")) {
          return NextResponse.json(
            { success: false, error: "لا تملك صلاحية لهذه العملية" },
            { status: 403 },
          );
        }
        return NextResponse.redirect(new URL("/forbidden", req.url));
      }
      break;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|api/health).*)",
  ],
};
