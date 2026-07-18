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
import { getPaymentById } from "@/lib/services/payment.service";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "payment.view")) return forbidden();

  const { id } = await params;
  const paymentId = parseInt(id, 10);
  if (isNaN(paymentId)) return badRequest("invalidId");

  try {
    const payment = await getPaymentById(paymentId);
    return ok(payment);
  } catch (e) {
    return handleServiceError(e);
  }
}
