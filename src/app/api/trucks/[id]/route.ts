import { NextRequest } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  ok,
  handleServiceError,
  hasPermission,
} from "@/lib/api-utils";
import { getOperationDetail } from "@/lib/services/truck.service";

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
