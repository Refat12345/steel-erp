import { NextRequest } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { withIdempotency } from "@/lib/idempotency";
import { closeOperation } from "@/lib/services/truck.service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "scale.close")) return forbidden();

  const { id } = await params;
  const truckId = parseInt(id, 10);
  if (isNaN(truckId)) return badRequest("معرّف غير صالح");

  return withIdempotency(req, session.userId, "", async () => {
    try {
      const truck = await closeOperation(truckId, session.userId);
      return ok(truck);
    } catch (e) {
      return handleServiceError(e);
    }
  });
}
