import { NextRequest, NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  parsePagination,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { auditLogListFiltersSchema } from "@/lib/validators/audit";
import { listAuditLogs } from "@/lib/services/audit.service";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "user.manage")) return forbidden();

  const pagination = parsePagination(req.nextUrl.searchParams);
  const parsedFilters = auditLogListFiltersSchema.safeParse({
    userId: req.nextUrl.searchParams.get("userId") ?? undefined,
    action: req.nextUrl.searchParams.get("action") ?? undefined,
    from: req.nextUrl.searchParams.get("from") ?? undefined,
    to: req.nextUrl.searchParams.get("to") ?? undefined,
  });
  if (!parsedFilters.success) {
    return badRequest(parsedFilters.error.issues[0]?.message || "بيانات غير صالحة");
  }

  try {
    const result = await listAuditLogs(parsedFilters.data, pagination);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return handleServiceError(e);
  }
}
