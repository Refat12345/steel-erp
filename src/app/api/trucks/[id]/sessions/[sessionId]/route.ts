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
import { withIdempotency, readJsonBody } from "@/lib/idempotency";
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

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return badRequest("بيانات غير صالحة");

  return withIdempotency(req, session.userId, parsed.text, async () => {
    const validated = weighSessionEditSchema.safeParse(parsed.json);
    if (!validated.success) {
      return badRequest(validated.error.issues[0]?.message || "بيانات غير صالحة");
    }

    try {
      const { expectedVersion, ...patch } = validated.data;
      const ws = await editWeighSession(
        truckId,
        sid,
        expectedVersion,
        patch,
        session.userId,
      );
      return ok(ws);
    } catch (e) {
      return handleServiceError(e);
    }
  });
}
