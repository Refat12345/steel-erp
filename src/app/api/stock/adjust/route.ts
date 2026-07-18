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
import { adjustmentSchema } from "@/lib/validators/stock-movement";
import { recordAdjustment } from "@/lib/services/stock.service";

export async function POST(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "stock.adjust")) return forbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalidData");
  }

  const parsed = adjustmentSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    const result = await recordAdjustment(parsed.data, session.userId);
    return ok(result);
  } catch (e) {
    return handleServiceError(e);
  }
}
