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
import { weighSessionEditSchema } from "@/lib/validators/truck";
import { editWeighSession } from "@/lib/services/truck.service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "scale.edit_session")) return forbidden();

  const { id, sessionId } = await params;
  const truckId = parseInt(id, 10);
  const sid = parseInt(sessionId, 10);
  if (isNaN(truckId) || isNaN(sid)) return badRequest("معرّف غير صالح");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("بيانات غير صالحة");
  }

  const parsed = weighSessionEditSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "بيانات غير صالحة");
  }

  try {
    const ws = await editWeighSession(truckId, sid, parsed.data, session.userId);
    return ok(ws);
  } catch (e) {
    return handleServiceError(e);
  }
}
