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
import { salesOrderCreateSchema } from "@/lib/validators/sales-order";
import { listSalesOrders, createSalesOrder } from "@/lib/services/sales-order.service";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "salesorder.view")) return forbidden();

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "";
  const kind = searchParams.get("kind") || "";
  const contractNumber = searchParams.get("contractNumber") || "";
  const pagination = parsePagination(searchParams);

  try {
    const result = await listSalesOrders(search, status, kind, contractNumber, pagination);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function POST(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "salesorder.create")) return forbidden();

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("بيانات غير صالحة"); }

  const parsed = salesOrderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "بيانات غير صالحة");
  }

  try {
    const so = await createSalesOrder(parsed.data, session.userId);
    return ok(so);
  } catch (e) {
    return handleServiceError(e);
  }
}
