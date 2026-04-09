import {
  getApiSession,
  unauthorized,
  forbidden,
  ok,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { listUsersForAuditFilter } from "@/lib/services/audit.service";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "user.manage")) return forbidden();

  try {
    const users = await listUsersForAuditFilter();
    return ok(users);
  } catch (e) {
    return handleServiceError(e);
  }
}
