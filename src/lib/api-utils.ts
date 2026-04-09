import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ServiceError } from "@/lib/services/errors";
import { logger } from "@/lib/logger";

export interface ApiSession {
  userId: number;
  username: string;
  role: string;
  permissions: string[];
}

export async function getApiSession(): Promise<ApiSession | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return {
    userId: session.user.id as number,
    username: session.user.username as string,
    role: session.user.role as string,
    permissions: session.user.permissions as string[],
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

export function notFound(entity = "العنصر") {
  return NextResponse.json(
    { success: false, error: `${entity} غير موجود` },
    { status: 404 }
  );
}

export function ok<T>(data: T) {
  return NextResponse.json({ success: true, data });
}

export function hasPermission(session: ApiSession, code: string): boolean {
  if (session.role === "admin") return true;
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

export function handleServiceError(e: unknown): NextResponse {
  if (e instanceof ServiceError) {
    const status = e.code === "NOT_FOUND" ? 404 : e.code === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ success: false, error: e.message }, { status });
  }
  logger.error({ err: e }, "unhandled error in route handler");
  return NextResponse.json(
    { success: false, error: "خطأ داخلي في الخادم" },
    { status: 500 },
  );
}
