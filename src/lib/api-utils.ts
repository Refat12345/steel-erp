import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ServiceError } from "@/lib/services/errors";
import { logger } from "@/lib/logger";
import { resolveUserAuth } from "@/lib/permissions";

export interface ApiSession {
  userId: number;
  username: string;
  role: string;
  permissions: string[];
}

/**
 * Authenticate via JWT (identity only), then resolve role + isActive +
 * permissions from the DB. The JWT is used solely to discover `userId`;
 * every authorization-relevant field (role, active status, permission
 * set) is re-read from the database with a short cache window.
 *
 * Returns `null` if the user no longer exists or has been deactivated —
 * callers must treat that identically to an unauthenticated request.
 */
export async function getApiSession(): Promise<ApiSession | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;

  const userId = session.user.id as number | undefined;
  if (typeof userId !== "number") return null;

  const authContext = await resolveUserAuth(userId);
  if (!authContext) return null;

  return {
    userId: authContext.userId,
    username: authContext.username,
    role: authContext.roleCode,
    permissions: Array.from(authContext.permissions),
  };
}

export function unauthorized() {
  return NextResponse.json(
    { success: false, error: "غير مصرح بالدخول" },
    { status: 401 }
  );
}

export function forbidden() {
  return NextResponse.json(
    { success: false, error: "لا تملك صلاحية لهذه العملية" },
    { status: 403 }
  );
}

export function badRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

export function tooManyRequests(retryAfterMs: number) {
  return NextResponse.json(
    { success: false, error: "عدد الطلبات تجاوز الحد المسموح، حاول بعد قليل" },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) },
    },
  );
}

export function notFound(entity = "العنصر") {
  return NextResponse.json(
    { success: false, error: `${entity} غير موجود` },
    { status: 404 }
  );
}

export function ok<T>(data: T) {
  return NextResponse.json({ success: true, data });
}

/**
 * Permission-only gate. No role-based bypasses: admin users receive the
 * full permission set from `resolveUserAuth`, so this check naturally
 * authorizes them without ever consulting `session.role`.
 */
export function hasPermission(session: ApiSession, code: string): boolean {
  return session.permissions.includes(code);
}

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function parsePagination(searchParams: URLSearchParams): PaginationParams {
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "25", 10) || 25));
  return { page, pageSize };
}

const SERVICE_ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  BAD_REQUEST: 400,
};

export function handleServiceError(e: unknown): NextResponse {
  if (e instanceof ServiceError) {
    const status = SERVICE_ERROR_STATUS[e.code] ?? 400;
    return NextResponse.json({ success: false, error: e.message }, { status });
  }
  logger.error({ err: e }, "unhandled error in route handler");
  return NextResponse.json(
    { success: false, error: "خطأ داخلي في الخادم" },
    { status: 500 },
  );
}
