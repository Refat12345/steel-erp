import {
  forbidden,
  getApiSession,
  handleServiceError,
  hasPermission,
  ok,
  unauthorized,
} from "@/lib/api-utils";
import { logger } from "@/lib/logger";
import { REPORTS_PERMISSION } from "@/lib/rbac-policy";
import { listBilletSuppliers } from "@/lib/services/billet-contract.service";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, REPORTS_PERMISSION)) return forbidden();

  try {
    const data = await listBilletSuppliers();
    return ok(data);
  } catch (err) {
    logger.error({ err }, "billet balance suppliers list error");
    return handleServiceError(err);
  }
}
