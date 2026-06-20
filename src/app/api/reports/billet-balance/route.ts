import { NextRequest } from "next/server";
import {
  badRequest,
  forbidden,
  getApiSession,
  handleServiceError,
  hasPermission,
  ok,
  unauthorized,
} from "@/lib/api-utils";
import { logger } from "@/lib/logger";
import { REPORTS_PERMISSION } from "@/lib/rbac-policy";
import { getBilletBalanceReport } from "@/lib/services/billet-contract.service";
import { billetBalanceQuerySchema } from "@/lib/validators/report";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, REPORTS_PERMISSION)) return forbidden();

  const parsed = billetBalanceQuerySchema.safeParse({
    supplierName: req.nextUrl.searchParams.get("supplierName") ?? undefined,
    contractNumber: req.nextUrl.searchParams.get("contractNumber") ?? undefined,
  });

  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid parameters");
  }

  try {
    const data = await getBilletBalanceReport({
      supplierName: parsed.data.supplierName,
      contractNumber: parsed.data.contractNumber,
    });
    return ok(data);
  } catch (err) {
    logger.error({ err }, "billet balance report error");
    return handleServiceError(err);
  }
}
