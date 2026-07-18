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
import { completedExternalCardCorrectionSchema } from "@/lib/validators/truck";
import { correctCompletedExternalCardNumber } from "@/lib/services/truck.service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "scale.correct_completed")) return forbidden();

  const { id } = await params;
  const truckId = parseInt(id, 10);
  if (isNaN(truckId)) return badRequest("invalidId");

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return badRequest("invalidData");

  return withIdempotency(req, session.userId, parsed.text, async () => {
    const validated = completedExternalCardCorrectionSchema.safeParse(parsed.json);
    if (!validated.success) {
      return badRequest(validated.error.issues[0]?.message || "invalidData");
    }

    try {
      const { externalCardNumber, reason, expectedVersion } = validated.data;
      const truck = await correctCompletedExternalCardNumber(
        truckId,
        externalCardNumber,
        reason,
        expectedVersion,
        session.userId,
      );
      return ok(truck);
    } catch (e) {
      return handleServiceError(e);
    }
  });
}
