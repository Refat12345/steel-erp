import { NextRequest, NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  hasPermission,
  handleServiceError,
  parsePagination,
} from "@/lib/api-utils";
import {
  getOperationalDayWindow,
  type OperationalDayWindow,
} from "@/lib/operational-day";
import { listLoadedTrucks } from "@/lib/services/truck.service";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "report.daily_trucks")) return forbidden();

  const { searchParams } = req.nextUrl;
  const pagination = parsePagination(searchParams);
  const customer = searchParams.get("customer");
  const operationalDate = searchParams.get("operationalDate");

  try {
    let window: OperationalDayWindow | null = null;
    if (operationalDate) {
      try {
        window = getOperationalDayWindow(operationalDate);
      } catch {
        return badRequest("تاريخ يوم التشغيل غير صالح");
      }
    }

    const result = await listLoadedTrucks(
      {
        customer: customer || undefined,
        dateFrom: window?.from,
        dateTo: window?.to,
      },
      pagination,
    );
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return handleServiceError(e);
  }
}
