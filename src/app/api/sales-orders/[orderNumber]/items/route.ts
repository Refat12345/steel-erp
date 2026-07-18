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
import { orderItemsSetSchema } from "@/lib/validators/sales-order";
import { setOrderItems } from "@/lib/services/sales-order.service";

interface Params {
  params: Promise<{ orderNumber: string }>;
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "salesorder.set_price")) return forbidden();

  const { orderNumber } = await params;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("invalidData"); }

  const parsed = orderItemsSetSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    const items = await setOrderItems(orderNumber, parsed.data.items, session.userId);
    return ok(items);
  } catch (e) {
    return handleServiceError(e);
  }
}
