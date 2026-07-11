import {
  getApiSession,
  unauthorized,
  forbidden,
  ok,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { listActiveSizes } from "@/lib/services/size-lookup.service";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (
    !hasPermission(session, "salesorder.view") &&
    !hasPermission(session, "scale.enter_session") &&
    // Report viewers need the size list for the size filter dropdown.
    !hasPermission(session, "report.daily_trucks")
  )
    return forbidden();

  try {
    const rows = await listActiveSizes();
    return ok(rows);
  } catch (e) {
    return handleServiceError(e);
  }
}
