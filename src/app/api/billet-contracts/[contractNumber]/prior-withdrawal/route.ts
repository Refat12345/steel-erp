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
import { priorWithdrawalSchema } from "@/lib/validators/billet-contract";
import { recordPriorWithdrawal } from "@/lib/services/billet-contract.service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contractNumber: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "billet.contract.prior_withdrawal")) {
    return forbidden();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("بيانات غير صالحة");
  }

  const parsed = priorWithdrawalSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "بيانات غير صالحة");
  }

  const { contractNumber } = await params;
  try {
    const receipt = await recordPriorWithdrawal(
      contractNumber,
      parsed.data,
      session.userId,
    );
    return ok(receipt);
  } catch (e) {
    return handleServiceError(e);
  }
}
