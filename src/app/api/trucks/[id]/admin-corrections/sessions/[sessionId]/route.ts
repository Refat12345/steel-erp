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
import {
  completedSessionEditSchema,
  completedSessionDeleteSchema,
} from "@/lib/validators/truck";
import {
  editCompletedSession,
  deleteCompletedSession,
} from "@/lib/services/truck.service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "scale.correct_completed")) return forbidden();

  const { id, sessionId } = await params;
  const truckId = parseInt(id, 10);
  const sid = parseInt(sessionId, 10);
  if (isNaN(truckId) || isNaN(sid)) return badRequest("invalidId");

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return badRequest("invalidData");

  return withIdempotency(req, session.userId, parsed.text, async () => {
    const validated = completedSessionEditSchema.safeParse(parsed.json);
    if (!validated.success) {
      return badRequest(validated.error.issues[0]?.message || "invalidData");
    }

    try {
      const { reason, expectedVersion, ...patch } = validated.data;
      const ws = await editCompletedSession(
        truckId,
        sid,
        patch,
        reason,
        expectedVersion,
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
  if (!hasPermission(session, "scale.correct_completed")) return forbidden();

  const { id, sessionId } = await params;
  const truckId = parseInt(id, 10);
  const sid = parseInt(sessionId, 10);
  if (isNaN(truckId) || isNaN(sid)) return badRequest("invalidId");

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return badRequest("invalidData");

  return withIdempotency(req, session.userId, parsed.text, async () => {
    const validated = completedSessionDeleteSchema.safeParse(parsed.json);
    if (!validated.success) {
      return badRequest(validated.error.issues[0]?.message || "invalidData");
    }

    try {
      const { reason, expectedVersion } = validated.data;
      const result = await deleteCompletedSession(
        truckId,
        sid,
        reason,
        expectedVersion,
        session.userId,
      );
      return ok(result);
    } catch (e) {
      return handleServiceError(e);
    }
  });
}
