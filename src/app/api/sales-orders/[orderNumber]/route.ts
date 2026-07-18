import { NextRequest } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { salesOrderUpdateSchema } from "@/lib/validators/sales-order";
import { getSalesOrderByNumber, updateSalesOrder } from "@/lib/services/sales-order.service";

interface Params {
  params: Promise<{ orderNumber: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "salesorder.view")) return forbidden();

  const { orderNumber } = await params;

  try {
    const so = await getSalesOrderByNumber(orderNumber);
    return ok(so);
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getApiSession();
  if (!session) return unauthorized();

  const { orderNumber } = await params;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("invalidData"); }

  const parsed = salesOrderUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  const data = parsed.data;

  if (data.status) {
    const statusPerms: Record<string, string> = {
      approved: "salesorder.approve",
      cancelled: "salesorder.cancel",
    };
    const requiredPerm = statusPerms[data.status] || "salesorder.edit_approved";
    if (!hasPermission(session, requiredPerm)) return forbidden();
  } else {
    if (!hasPermission(session, "salesorder.edit_draft") && !hasPermission(session, "salesorder.edit_approved")) {
      return forbidden();
    }
  }

  try {
    const so = await updateSalesOrder(orderNumber, data, session.userId);
    return ok(so);
  } catch (e) {
    return handleServiceError(e);
  }
}
