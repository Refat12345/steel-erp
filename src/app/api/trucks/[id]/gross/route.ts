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
import { grossSchema } from "@/lib/validators/truck";
import { enterGross } from "@/lib/services/truck.service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "scale.enter_gross")) return forbidden();

  const { id } = await params;
  const truckId = parseInt(id, 10);
  if (isNaN(truckId)) return badRequest("invalidId");

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return badRequest("invalidData");

  return withIdempotency(req, session.userId, parsed.text, async () => {
    const rl = checkRateLimit(`scale:${session.userId}`, SCALE_WRITE_RATE_LIMIT);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

    const validated = grossSchema.safeParse(parsed.json);
    if (!validated.success) {
      return badRequest(validated.error.issues[0]?.message || "invalidData");
    }

    try {
      const truck = await enterGross(
        truckId,
        validated.data.weightKg,
        session.userId,
        validated.data.exit,
      );
      return ok(truck);
    } catch (e) {
      return handleServiceError(e);
    }
  });
}
