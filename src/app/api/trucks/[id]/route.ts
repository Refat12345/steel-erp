import { NextRequest } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  handleServiceError,
  hasPermission,
} from "@/lib/api-utils";
import { withIdempotency, readJsonBody } from "@/lib/idempotency";
import { truckUpdateSchema } from "@/lib/validators/truck";
import {
  getOperationDetail,
  updateTruckBeforeWeigh,
} from "@/lib/services/truck.service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (
    !hasPermission(session, "truck.view_queue") &&
    !hasPermission(session, "truck.view_approved")
  )
    return forbidden();

  const { id } = await params;
  const truckId = parseInt(id, 10);
  if (isNaN(truckId)) return unauthorized();

  try {
    const truck = await getOperationDetail(truckId);
    return ok(truck);
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (
    !hasPermission(session, "truck.edit_queued") &&
    !hasPermission(session, "truck.edit_approved")
  )
    return forbidden();

  const { id } = await params;
  const truckId = parseInt(id, 10);
  if (isNaN(truckId)) return badRequest("معرّف غير صالح");

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return badRequest("بيانات غير صالحة");

  return withIdempotency(req, session.userId, parsed.text, async () => {
    const validated = truckUpdateSchema.safeParse(parsed.json);
    if (!validated.success) {
      return badRequest(validated.error.issues[0]?.message || "بيانات غير صالحة");
    }

    try {
      const current = await getOperationDetail(truckId);
      if (current.status === "Queued" && !hasPermission(session, "truck.edit_queued")) {
        return forbidden();
      }
      if (current.status === "Approved" && !hasPermission(session, "truck.edit_approved")) {
        return forbidden();
      }

      const { expectedVersion, ...patch } = validated.data;
      const truck = await updateTruckBeforeWeigh(
        truckId,
        {
          ...patch,
          salesOrderNumber: patch.salesOrderNumber || null,
          notes: patch.notes || null,
        },
        expectedVersion,
        session.userId,
      );
      return ok(truck);
    } catch (e) {
      return handleServiceError(e);
    }
  });
}
