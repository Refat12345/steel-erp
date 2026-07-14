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
import { stockLocationUpdateSchema } from "@/lib/validators/stock-location";
import {
  updateLocation,
  removeLocation,
} from "@/lib/services/stock-location.service";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "stock.location.manage")) return forbidden();

  const { id } = await params;
  const locationId = parseInt(id, 10);
  if (isNaN(locationId)) return badRequest("معرّف غير صالح");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("بيانات غير صالحة");
  }

  const parsed = stockLocationUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "بيانات غير صالحة");
  }

  try {
    const location = await updateLocation(locationId, parsed.data, session.userId);
    return ok(location);
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "stock.location.manage")) return forbidden();

  const { id } = await params;
  const locationId = parseInt(id, 10);
  if (isNaN(locationId)) return badRequest("معرّف غير صالح");

  try {
    const result = await removeLocation(locationId, session.userId);
    return ok(result);
  } catch (e) {
    return handleServiceError(e);
  }
}
