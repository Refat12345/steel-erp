import { NextRequest } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  handleServiceError,
  tooManyRequests,
} from "@/lib/api-utils";
import { checkRateLimit, SCALE_WRITE_RATE_LIMIT } from "@/lib/rate-limit";
import { withIdempotency, readJsonBody } from "@/lib/idempotency";
import {
  weighSessionEditSchema,
  weighSessionDeleteSchema,
} from "@/lib/validators/truck";
import { editWeighSession, deleteWeighSession } from "@/lib/services/truck.service";

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
  if (isNaN(truckId) || isNaN(sid)) return badRequest("invalidId");

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return badRequest("invalidData");

  return withIdempotency(req, session.userId, parsed.text, async () => {
    const validated = weighSessionEditSchema.safeParse(parsed.json);
    if (!validated.success) {
      return badRequest(validated.error.issues[0]?.message || "invalidData");
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "scale.delete_session")) return forbidden();

  const { id, sessionId } = await params;
  const truckId = parseInt(id, 10);
  const sid = parseInt(sessionId, 10);
  if (isNaN(truckId) || isNaN(sid)) return badRequest("invalidId");

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return badRequest("invalidData");

  return withIdempotency(req, session.userId, parsed.text, async () => {
    const rl = checkRateLimit(`scale:${session.userId}`, SCALE_WRITE_RATE_LIMIT);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

    const validated = weighSessionDeleteSchema.safeParse(parsed.json);
    if (!validated.success) {
      return badRequest(validated.error.issues[0]?.message || "invalidData");
    }

    try {
      const result = await deleteWeighSession(
        truckId,
        sid,
        validated.data.expectedVersion,
        session.userId,
      );
      return ok(result);
    } catch (e) {
      return handleServiceError(e);
    }
  });
}
