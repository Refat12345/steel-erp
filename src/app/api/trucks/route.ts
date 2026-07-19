import { NextRequest, NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  handleServiceError,
  parsePagination,
} from "@/lib/api-utils";
import { withIdempotency, readJsonBody } from "@/lib/idempotency";
import {
  getOperationalDayWindow,
  type OperationalDayWindow,
} from "@/lib/operational-day";
import { truckRegisterSchema } from "@/lib/validators/truck";
import { registerTruck, listOperations } from "@/lib/services/truck.service";
import { getAnalyticsStartDateValue } from "@/lib/services/settings.service";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import { withLocalizedTruckLabels } from "@/lib/localized-name";
import type { TruckStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (
    !hasPermission(session, "truck.view_queue") &&
    !hasPermission(session, "truck.view_approved")
  )
    return forbidden();

  const { searchParams } = req.nextUrl;
  const pagination = parsePagination(searchParams);
  const status = searchParams.get("status") as TruckStatus | null;
  const plateNumber = searchParams.get("plateNumber");
  const operationalDate = searchParams.get("operationalDate");

  try {
    let window: OperationalDayWindow | null = null;
    if (operationalDate) {
      try {
        window = getOperationalDayWindow(operationalDate);
      } catch {
        return badRequest("invalidOperationalDate");
      }
    }

    const locale = await getRequestLocale();
    const [result, analyticsStartDate] = await Promise.all([
      listOperations(
        {
          status: status || undefined,
          plateNumber: plateNumber || undefined,
          dateFrom: window?.from,
          dateTo: window?.to,
        },
        pagination,
      ),
      getAnalyticsStartDateValue(),
    ]);
    return NextResponse.json({
      success: true,
      ...result,
      data: result.data.map((row) => withLocalizedTruckLabels(row, locale)),
      analyticsStartDate,
    });
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function POST(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "truck.register")) return forbidden();

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return badRequest("invalidData");

  return withIdempotency(req, session.userId, parsed.text, async () => {
    const validated = truckRegisterSchema.safeParse(parsed.json);
    if (!validated.success) {
      return badRequest(validated.error.issues[0]?.message || "invalidData");
    }
    try {
      const truck = await registerTruck(
        {
          ...validated.data,
          salesOrderNumber: validated.data.salesOrderNumber || null,
          notes: validated.data.notes || null,
        },
        session.userId,
      );
      return ok(truck);
    } catch (e) {
      return handleServiceError(e);
    }
  });
}
