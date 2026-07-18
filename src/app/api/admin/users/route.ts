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
    const result = await listUsers({ roleCode, isActive, search }, pagination);
    return NextResponse.json({ success: true, ...result });
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
