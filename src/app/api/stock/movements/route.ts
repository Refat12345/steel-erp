import { NextRequest, NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  handleServiceError,
  parsePagination,
} from "@/lib/api-utils";
import { withIdempotency, readJsonBody } from "@/lib/idempotency";
import { StockMovementType } from "@prisma/client";
import { productionInSchema } from "@/lib/validators/stock-movement";
import { listMovements, recordProductionIn } from "@/lib/services/stock.service";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "stock.movements.view")) return forbidden();

  const { searchParams } = req.nextUrl;
  const filters: Parameters<typeof listMovements>[0] = {};

  const locationId = parseInt(searchParams.get("locationId") || "", 10);
  if (!isNaN(locationId)) filters.locationId = locationId;

  const type = searchParams.get("type");
  if (type && type in StockMovementType) {
    filters.type = type as StockMovementType;
  }

  const from = searchParams.get("from");
  if (from) {
    const d = new Date(from);
    if (!isNaN(d.getTime())) filters.from = d;
  }
  const to = searchParams.get("to");
  if (to) {
    const d = new Date(to);
    if (!isNaN(d.getTime())) filters.to = d;
  }

  const pagination = parsePagination(searchParams);

  try {
    const result = await listMovements(filters, pagination);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function POST(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return badRequest("بيانات غير صالحة");

  // Wrap in idempotency replay protection so a double-tap or network retry
  // (same Idempotency-Key) does not record the production entry twice.
  return withIdempotency(req, session.userId, parsedBody.text, async () => {
    const parsed = productionInSchema.safeParse(parsedBody.json);
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message || "بيانات غير صالحة");
    }

    // Production entry is split by unit across two roles: one records tonnage,
    // another counts bundles. Enforce the matching permission per unit.
    const requiredPermission =
      parsed.data.unit === "TON" ? "stock.production.ton" : "stock.production.bundle";
    if (!hasPermission(session, requiredPermission)) return forbidden();

    try {
      const result = await recordProductionIn(parsed.data, session.userId);
      return ok(result);
    } catch (e) {
      return handleServiceError(e);
    }
  });
}
