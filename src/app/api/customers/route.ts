import { NextRequest, NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  handleServiceError,
  parsePagination,
} from "@/lib/api-utils";
import { customerCreateSchema } from "@/lib/validators/customer";
import { listCustomers, createCustomer } from "@/lib/services/customer.service";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "contract.view")) return forbidden();

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") || "";
  const activeOnly = searchParams.get("active") !== "false";
  const pagination = parsePagination(searchParams);

  try {
    const result = await listCustomers(search, activeOnly, pagination);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function POST(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "contract.create")) return forbidden();

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("بيانات غير صالحة"); }

  const parsed = customerCreateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "بيانات غير صالحة");
  }

  try {
    const result = await createCustomer(parsed.data, session.userId);
    return ok(result);
  } catch (e) {
    return handleServiceError(e);
  }
}
