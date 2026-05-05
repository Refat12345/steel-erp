import { NextRequest } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  ok,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { listActiveDestinations } from "@/lib/services/destination.service";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (
    !hasPermission(session, "truck.register") &&
    !hasPermission(session, "truck.view_queue") &&
    !hasPermission(session, "truck.view_approved")
  )
    return forbidden();

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") || "";
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  try {
    const destinations = await listActiveDestinations({
      search,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return ok(destinations);
  } catch (e) {
    return handleServiceError(e);
  }
}
