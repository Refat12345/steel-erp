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
import { correctGrossSchema } from "@/lib/validators/truck";
import { correctGross } from "@/lib/services/truck.service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "scale.enter_gross")) return forbidden();

  const { id } = await params;
  const truckId = parseInt(id, 10);
  if (isNaN(truckId)) return badRequest("معرّف غير صالح");

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return badRequest("بيانات غير صالحة");

  return withIdempotency(req, session.userId, parsed.text, async () => {
    const validated = correctGrossSchema.safeParse(parsed.json);
    if (!validated.success) {
      return badRequest(validated.error.issues[0]?.message || "بيانات غير صالحة");
    }

    try {
      const truck = await correctGross(
        truckId,
        validated.data.weightKg,
        validated.data.expectedVersion,
        session.userId,
      );
      return ok(truck);
    } catch (e) {
      return handleServiceError(e);
    }
  });
}
