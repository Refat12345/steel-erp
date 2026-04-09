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
import { customerUpdateSchema } from "@/lib/validators/customer";
import { getCustomerById, updateCustomer } from "@/lib/services/customer.service";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "contract.view")) return forbidden();

  const { id } = await params;
  const customerId = parseInt(id, 10);
  if (isNaN(customerId)) return badRequest("معرّف غير صالح");

  try {
    const customer = await getCustomerById(customerId);
    return ok(customer);
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "contract.edit")) return forbidden();

  const { id } = await params;
  const customerId = parseInt(id, 10);
  if (isNaN(customerId)) return badRequest("معرّف غير صالح");

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("بيانات غير صالحة"); }

  const parsed = customerUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "بيانات غير صالحة");
  }

  try {
    const customer = await updateCustomer(customerId, parsed.data, session.userId);
    return ok(customer);
  } catch (e) {
    return handleServiceError(e);
  }
}
