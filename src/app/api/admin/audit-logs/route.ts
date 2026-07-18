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
import { listAuditLogs, type AuditLogListFilters } from "@/lib/services/audit.service";
import type { AuditAction } from "@prisma/client";

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
    return badRequest(parsedFilters.error.issues[0]?.message || "invalidData");
  }

  try {
    const filters: AuditLogListFilters = {
      ...(parsedFilters.data.userId != null && { userId: parsedFilters.data.userId }),
      ...(parsedFilters.data.action != null && { action: parsedFilters.data.action as AuditAction }),
      ...(parsedFilters.data.from != null && { from: parsedFilters.data.from }),
      ...(parsedFilters.data.to != null && { to: parsedFilters.data.to }),
    };
    const result = await listAuditLogs(filters, pagination);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return handleServiceError(e);
  }
}
