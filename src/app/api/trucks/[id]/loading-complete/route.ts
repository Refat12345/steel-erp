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
import { withIdempotency } from "@/lib/idempotency";
import { confirmLoadingComplete } from "@/lib/services/truck.service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "scale.loading_complete")) return forbidden();

  const { id } = await params;
  const truckId = parseInt(id, 10);
  if (isNaN(truckId)) return badRequest("معرّف غير صالح");

  // Body-less endpoint; feed an empty string for hashing so retries match.
  return withIdempotency(req, session.userId, "", async () => {
    const rl = checkRateLimit(`scale:${session.userId}`, SCALE_WRITE_RATE_LIMIT);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

    try {
      const truck = await confirmLoadingComplete(truckId, session.userId);
      return ok(truck);
    } catch (e) {
      return handleServiceError(e);
    }
  });
}
