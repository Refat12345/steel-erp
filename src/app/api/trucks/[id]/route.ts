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
  type UpdateTruckInput,
} from "@/lib/services/truck.service";
import { computeTruckTimings } from "@/lib/truck-timing";

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
    const timings = computeTruckTimings({
      createdAt: truck.createdAt,
      tareTime: truck.tareTime,
      grossTime: truck.grossTime,
      closedAt: truck.closedAt,
      status: truck.status,
      loadingConfirmedAt: truck.loadingConfirmedAt,
      lastReopenedAt: truck.lastReopenedAt,
      sessions: truck.sessions,
      loader: truck.loader,
    });
    return ok({ ...truck, timings });
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
      if (
        (current.status === "Approved" || current.status === "FirstWeigh") &&
        !hasPermission(session, "truck.edit_approved")
      ) {
        return forbidden();
      }

      const { expectedVersion, ...patch } = validated.data;
      const updateInput: UpdateTruckInput = { ...patch };
      // Only normalize fields the client actually sent. Injecting `null` for omitted
      // keys would look like an attempted SO/notes change and trip FirstWeigh guards.
      if (patch.salesOrderNumber !== undefined) {
        updateInput.salesOrderNumber = patch.salesOrderNumber || null;
      }
      if (patch.notes !== undefined) {
        updateInput.notes = patch.notes || null;
      }
      const truck = await updateTruckBeforeWeigh(
        truckId,
        updateInput,
        expectedVersion,
        session.userId,
      );
      return ok(truck);
    } catch (e) {
      return handleServiceError(e);
    }
  });
}
