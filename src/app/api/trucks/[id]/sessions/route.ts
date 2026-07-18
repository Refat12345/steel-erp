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
import { weighSessionSchema } from "@/lib/validators/truck";
import { enterWeighSession } from "@/lib/services/truck.service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "scale.enter_session")) return forbidden();

  const { id } = await params;
  const truckId = parseInt(id, 10);
  if (isNaN(truckId)) return badRequest("invalidId");

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return badRequest("invalidData");

  return withIdempotency(req, session.userId, parsed.text, async () => {
    const rl = checkRateLimit(`scale:${session.userId}`, SCALE_WRITE_RATE_LIMIT);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

    const validated = weighSessionSchema.safeParse(parsed.json);
    if (!validated.success) {
      return badRequest(validated.error.issues[0]?.message || "invalidData");
    }

    try {
      const ws = await enterWeighSession(truckId, validated.data, session.userId);
      return ok(ws);
    } catch (e) {
      return handleServiceError(e);
    }
  });
}
