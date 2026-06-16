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
import { loadedWeightSchema } from "@/lib/validators/billet-receipt";
import { enterLoadedWeight } from "@/lib/services/billet-receipt.service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "billet.receipt.weigh")) return forbidden();

  const { id } = await params;
  const receiptId = parseInt(id, 10);
  if (isNaN(receiptId)) return badRequest("معرّف غير صالح");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("بيانات غير صالحة");
  }

  const parsed = loadedWeightSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "بيانات غير صالحة");
  }

  try {
    const receipt = await enterLoadedWeight(receiptId, parsed.data.weightKg, session.userId);
    return ok(receipt);
  } catch (e) {
    return handleServiceError(e);
  }
}
