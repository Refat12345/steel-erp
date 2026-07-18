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
import { getDailyLoadingSummary } from "@/lib/services/report.service";
import { loadingSummaryQuerySchema } from "@/lib/validators/report";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "report.daily_trucks")) return forbidden();

  const parsed = loadingSummaryQuerySchema.safeParse({
    date: req.nextUrl.searchParams.get("date"),
    period: req.nextUrl.searchParams.get("period") ?? undefined,
    customerId: req.nextUrl.searchParams.get("customerId") ?? undefined,
    product: req.nextUrl.searchParams.get("product") ?? undefined,
    grade: req.nextUrl.searchParams.get("grade") ?? undefined,
  });

  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "invalidParams");
  }

  try {
    const data = await getDailyLoadingSummary({
      operationalDate: parsed.data.date,
      period: parsed.data.period,
      customerId: parsed.data.customerId,
      productFilter: parsed.data.productFilter,
    });
    return ok(data);
  } catch (err) {
    logger.error({ err }, "daily loading summary report error");
    return handleServiceError(err);
  }
}
