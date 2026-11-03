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
import { getLoaderTrucksReport } from "@/lib/services/report.service";
import { loaderTrucksQuerySchema } from "@/lib/validators/report";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "report.loader_trucks")) return forbidden();

  const parsed = loaderTrucksQuerySchema.safeParse({
    from: req.nextUrl.searchParams.get("from"),
    to: req.nextUrl.searchParams.get("to"),
  });

  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "invalidParams");
  }

  try {
    const data = await getLoaderTrucksReport({
      fromDate: parsed.data.from,
      toDate: parsed.data.to,
    });
    return ok(data);
  } catch (err) {
    logger.error({ err }, "loader trucks report error");
    return handleServiceError(err);
  }
}
