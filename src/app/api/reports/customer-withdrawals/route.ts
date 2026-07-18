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
import { getCustomerWithdrawalsReport } from "@/lib/services/report.service";
import { customerWithdrawalsQuerySchema } from "@/lib/validators/report";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "report.daily_trucks")) return forbidden();

  const parsed = customerWithdrawalsQuerySchema.safeParse({
    from: req.nextUrl.searchParams.get("from"),
    to: req.nextUrl.searchParams.get("to"),
    customerId: req.nextUrl.searchParams.get("customerId") ?? undefined,
    sizeId: req.nextUrl.searchParams.get("sizeId") ?? undefined,
  });

  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "invalidParams");
  }

  try {
    const data = await getCustomerWithdrawalsReport({
      fromDate: parsed.data.from,
      toDate: parsed.data.to,
      customerId: parsed.data.customerId,
      sizeId: parsed.data.sizeId,
    });
    return ok(data);
  } catch (err) {
    logger.error({ err }, "customer withdrawals report error");
    return handleServiceError(err);
  }
}
