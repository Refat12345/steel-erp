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
import { unloadResultSchema } from "@/lib/validators/billet-receipt";
import { enterUnloadResult } from "@/lib/services/billet-receipt.service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "billet.receipt.unload")) return forbidden();

  const { id } = await params;
  const receiptId = parseInt(id, 10);
  if (isNaN(receiptId)) return badRequest("invalidId");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalidData");
  }

  const parsed = unloadResultSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    const receipt = await enterUnloadResult(receiptId, parsed.data, session.userId);
    return ok(receipt);
  } catch (e) {
    return handleServiceError(e);
  }
}
