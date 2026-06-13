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
import { loadingCompleteSchema } from "@/lib/validators/truck";
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

  // Body is optional (older clients send none) — an empty body confirms
  // without declaring a round grade. readJsonBody maps "" to {}.
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return badRequest("بيانات غير صالحة");

  return withIdempotency(req, session.userId, parsed.text, async () => {
    const rl = checkRateLimit(`scale:${session.userId}`, SCALE_WRITE_RATE_LIMIT);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

    const validated = loadingCompleteSchema.safeParse(parsed.json ?? {});
    if (!validated.success) {
      return badRequest(validated.error.issues[0]?.message || "بيانات غير صالحة");
    }

    try {
      const truck = await confirmLoadingComplete(
        truckId,
        session.userId,
        validated.data.grade,
      );
      return ok(truck);
    } catch (e) {
      return handleServiceError(e);
    }
  });
}
