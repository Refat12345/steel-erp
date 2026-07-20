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
import { getRequestLocale } from "@/lib/i18n/request-locale";
import {
  localizedDestination,
  localizedDestinationDetails,
} from "@/lib/localized-name";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (
    !hasPermission(session, "truck.register") &&
    !hasPermission(session, "truck.view_queue") &&
    !hasPermission(session, "truck.view_approved") &&
    !hasPermission(session, "report.daily_trucks")
  )
    return forbidden();

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") || "";
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  try {
    const locale = await getRequestLocale();
    const destinations = await listActiveDestinations({
      search,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    // Localize the display name (search still matches the raw Arabic column).
    // Details are Arabic-only — omit them in English so the UI stays clean.
    return ok(
      destinations.map((d) => ({
        id: d.id,
        name: localizedDestination(d, locale),
        details: localizedDestinationDetails(d.details, locale),
      })),
    );
  } catch (e) {
    return handleServiceError(e);
  }
}
