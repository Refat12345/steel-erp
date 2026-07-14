import { NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { listTodayProduction } from "@/lib/services/stock.service";

/**
 * Today's production-in entries, for the production-entry screen. Gated by the
 * production permissions (either unit) so clerks who lack the full movement-log
 * permission can still see what was recorded today and avoid duplicates.
 */
export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (
    !hasPermission(session, "stock.production.ton") &&
    !hasPermission(session, "stock.production.bundle") &&
    !hasPermission(session, "stock.movements.view")
  ) {
    return forbidden();
  }

  try {
    const data = await listTodayProduction();
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return handleServiceError(e);
  }
}
