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
import { paymentCreateSchema } from "@/lib/validators/payment";
import {
  listPayments,
  createPayment,
  listCustomersForPayment,
} from "@/lib/services/payment.service";
import type { PaymentMethod } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "payment.view")) return forbidden();

  const { searchParams } = req.nextUrl;

  if (searchParams.get("scope") === "customers") {
    try {
      const customers = await listCustomersForPayment();
      return ok(customers);
    } catch (e) {
      return handleServiceError(e);
    }
  }

  const pagination = parsePagination(searchParams);
  const customerId = searchParams.get("customerId");
  const method = searchParams.get("method") as PaymentMethod | null;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  try {
    const result = await listPayments(
      {
        customerId: customerId ? parseInt(customerId, 10) : undefined,
        method: method || undefined,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      },
      pagination,
    );
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function POST(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "payment.create")) return forbidden();

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("invalidData"); }

  const parsed = paymentCreateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    const result = await createPayment(parsed.data, session.userId);
    return ok(result);
  } catch (e) {
    return handleServiceError(e);
  }
}
