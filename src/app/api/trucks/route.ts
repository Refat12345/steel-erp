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
import { truckRegisterSchema } from "@/lib/validators/truck";
import { registerTruck, listOperations } from "@/lib/services/truck.service";
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
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  try {
    const result = await listOperations(
      {
        status: status || undefined,
        plateNumber: plateNumber || undefined,
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
      },
      pagination,
    );
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function POST(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "truck.register")) return forbidden();

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return badRequest("بيانات غير صالحة");

  return withIdempotency(req, session.userId, parsed.text, async () => {
    const validated = truckRegisterSchema.safeParse(parsed.json);
    if (!validated.success) {
      return badRequest(validated.error.issues[0]?.message || "بيانات غير صالحة");
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
