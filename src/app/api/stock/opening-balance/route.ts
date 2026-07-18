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
import { productionInSchema } from "@/lib/validators/stock-movement";
import { recordOpeningBalance } from "@/lib/services/stock.service";

export async function POST(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "stock.opening_balance")) return forbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalidData");
  }

  const parsed = productionInSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    const result = await recordOpeningBalance(parsed.data, session.userId);
    return ok(result);
  } catch (e) {
    return handleServiceError(e);
  }
}
