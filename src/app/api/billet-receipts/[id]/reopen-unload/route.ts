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
import { reopenUnloadResult } from "@/lib/services/billet-receipt.service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "billet.receipt.unload")) return forbidden();

  const { id } = await params;
  const receiptId = parseInt(id, 10);
  if (isNaN(receiptId)) return badRequest("معرّف غير صالح");

  try {
    const receipt = await reopenUnloadResult(receiptId, session.userId);
    return ok(receipt);
  } catch (e) {
    return handleServiceError(e);
  }
}
