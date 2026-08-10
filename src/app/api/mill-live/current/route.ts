import {
  getApiSession,
  unauthorized,
  forbidden,
  ok,
  handleServiceError,
} from "@/lib/api-utils";
import { canAccessMillLiveDashboard } from "@/lib/mill-live-access";
import { getLatestMillLiveSnapshot } from "@/lib/services/mill-live.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!canAccessMillLiveDashboard(session.username)) return forbidden();

  try {
    const snapshot = await getLatestMillLiveSnapshot();
    return ok(snapshot);
  } catch (err) {
    return handleServiceError(err);
  }
}
