import { NextRequest, NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  parsePagination,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { createUserSchema } from "@/lib/validators/user";
import { listUsers, createUser } from "@/lib/services/user.service";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import { localizedRole } from "@/lib/localized-name";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "user.manage")) return forbidden();

  const pagination = parsePagination(req.nextUrl.searchParams);
  const roleCode = req.nextUrl.searchParams.get("roleCode") || undefined;
  const isActiveParam = req.nextUrl.searchParams.get("isActive");
  const search = req.nextUrl.searchParams.get("search") || undefined;

  const isActive =
    isActiveParam === "true" ? true : isActiveParam === "false" ? false : undefined;

  try {
    const locale = await getRequestLocale();
    const result = await listUsers({ roleCode, isActive, search }, pagination);
    const data = result.data.map((u) => ({
      ...u,
      role: { ...u.role, displayName: localizedRole(u.role, locale) },
    }));
    return NextResponse.json({ success: true, ...result, data });
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function POST(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "user.manage")) return forbidden();

  const body = await req.json();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    const user = await createUser(parsed.data, session.userId);
    return NextResponse.json({ success: true, data: user }, { status: 201 });
  } catch (e) {
    return handleServiceError(e);
  }
}
