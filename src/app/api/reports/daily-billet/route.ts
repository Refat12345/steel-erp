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
import { getDailyBilletReport } from "@/lib/services/report.service";
import { dailyBilletReportQuerySchema } from "@/lib/validators/report";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, REPORTS_PERMISSION)) return forbidden();

  const parsed = dailyBilletReportQuerySchema.safeParse({
    date: req.nextUrl.searchParams.get("date"),
    supplierName: req.nextUrl.searchParams.get("supplierName") ?? undefined,
    contractNumber: req.nextUrl.searchParams.get("contractNumber") ?? undefined,
  });

  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "invalidParams");
  }

  try {
    const data = await getDailyBilletReport({
      operationalDate: parsed.data.date,
      supplierName: parsed.data.supplierName,
      contractNumber: parsed.data.contractNumber,
    });
    return ok(data);
  } catch (err) {
    logger.error({ err }, "daily billet report error");
    return handleServiceError(err);
  }
}
