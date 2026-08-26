import { NextRequest } from "next/server";
import { z } from "zod";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { markLocationClassification } from "@/lib/services/stock-location.service";

const bodySchema = z.object({
  classificationId: z.number().int().positive(),
});

const MARK_PERMISSION = "stock.classification.mark";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Mark an occupied first-grade bay as B500B from the live stock map.
 * Gated by `stock.classification.mark` (granted per user; not a role default).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, MARK_PERMISSION)) return forbidden();

  const { id } = await params;
  const locationId = parseInt(id, 10);
  if (isNaN(locationId)) return badRequest("invalidId");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalidData");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return badRequest("invalidData");

  try {
    const result = await markLocationClassification(
      locationId,
      parsed.data.classificationId,
      session.userId,
    );
    return ok({
      locationId: result.location.id,
      retaggedLines: result.retaggedLines,
      expectedClassification: result.classification,
    });
  } catch (e) {
    return handleServiceError(e);
  }
}
