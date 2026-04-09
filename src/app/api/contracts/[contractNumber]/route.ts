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
import { contractUpdateSchema } from "@/lib/validators/contract";
import { getContractByNumber, updateContract } from "@/lib/services/contract.service";

interface Params {
  params: Promise<{ contractNumber: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "contract.view")) return forbidden();

  const { contractNumber } = await params;

  try {
    const contract = await getContractByNumber(contractNumber);
    return ok(contract);
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getApiSession();
  if (!session) return unauthorized();

  const { contractNumber } = await params;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("بيانات غير صالحة"); }

  const parsed = contractUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "بيانات غير صالحة");
  }

  const data = parsed.data;

  if (data.status) {
    if (!hasPermission(session, "contract.change_status")) return forbidden();
  } else {
    if (!hasPermission(session, "contract.edit")) return forbidden();
  }

  try {
    const contract = await updateContract(contractNumber, data, session.userId);
    return ok(contract);
  } catch (e) {
    return handleServiceError(e);
  }
}
