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
import { DAILY_TRUCKS_SENSITIVE_TONNAGE_PERMISSION } from "@/lib/report-permissions";
import { getDailyTrucksReport } from "@/lib/services/report.service";
import { dailyTrucksReportQuerySchema } from "@/lib/validators/report";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "report.daily_trucks")) return forbidden();

  const parsed = dailyTrucksReportQuerySchema.safeParse({
    date: req.nextUrl.searchParams.get("date"),
    customerId: req.nextUrl.searchParams.get("customerId") ?? undefined,
    product: req.nextUrl.searchParams.get("product") ?? undefined,
    grade: req.nextUrl.searchParams.get("grade") ?? undefined,
  });

  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "معاملات غير صالحة");
  }

  try {
    const data = await getDailyTrucksReport({
      operationalDate: parsed.data.date,
      customerId: parsed.data.customerId,
      productFilter: parsed.data.productFilter,
      canViewSensitiveTonnage: hasPermission(
        session,
        DAILY_TRUCKS_SENSITIVE_TONNAGE_PERMISSION,
      ),
    });
    return ok(data);
  } catch (err) {
    logger.error({ err }, "daily trucks report error");
    return handleServiceError(err);
  }
}
