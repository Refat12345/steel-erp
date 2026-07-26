import { NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { correctProductionInSchema } from "@/lib/validators/stock-movement";
import { correctProductionIn } from "@/lib/services/stock.service";

export async function POST(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "stock.production.correct")) return forbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalidData");
  }

  const parsed = correctProductionInSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    const result = await correctProductionIn(parsed.data, session.userId);
    let warning: string | null = null;
    if (result.warningKey && result.warningParams) {
      const t = await getTranslations("errors");
      warning = t(result.warningKey, result.warningParams);
    }
    return ok({
      originalMovementId: result.originalMovementId,
      reverseMovementId: result.reverseMovementId,
      newMovementId: result.newMovementId,
      reversedQuantity: result.reversedQuantity,
      partialReverse: result.partialReverse,
      warning,
    });
  } catch (e) {
    return handleServiceError(e);
  }
}
