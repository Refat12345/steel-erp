import { NextRequest } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  hasAnyPermission,
  STOCK_STRUCTURE_READ_PERMISSIONS,
  handleServiceError,
} from "@/lib/api-utils";
import { stockLocationCreateSchema } from "@/lib/validators/stock-location";
import {
  listYardsWithLocations,
  createLocation,
} from "@/lib/services/stock-location.service";
import { listActiveSizes } from "@/lib/services/size-lookup.service";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasAnyPermission(session, ...STOCK_STRUCTURE_READ_PERMISSIONS)) {
    return forbidden();
  }

  try {
    const [yards, sizes] = await Promise.all([
      listYardsWithLocations(),
      listActiveSizes(),
    ]);
    // `canManage` lets the client decide whether to render edit controls,
    // while the server still enforces the real gate on every mutation.
    return ok({
      yards,
      sizes,
      canManage: hasPermission(session, "stock.location.manage"),
    });
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function POST(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "stock.location.manage")) return forbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalidData");
  }

  const parsed = stockLocationCreateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    const location = await createLocation(parsed.data, session.userId);
    return ok(location);
  } catch (e) {
    return handleServiceError(e);
  }
}
