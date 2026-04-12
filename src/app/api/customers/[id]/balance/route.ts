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
import { getCustomerBalance } from "@/lib/services/payment.service";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "payment.view")) return forbidden();

  const { id } = await params;
  const customerId = parseInt(id, 10);
  if (isNaN(customerId)) return badRequest("معرّف غير صالح");

  try {
    const balance = await getCustomerBalance(customerId);
    return ok(balance);
  } catch (e) {
    return handleServiceError(e);
  }
}
