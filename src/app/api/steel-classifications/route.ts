import {
  getApiSession,
  unauthorized,
  forbidden,
  ok,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { listActiveClassifications } from "@/lib/services/steel-classification.service";
import { offeredSteelClassifications } from "@/lib/steel-classification-default";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import { localizedClassification } from "@/lib/localized-name";

/**
 * Consumers of the classification dropdown: truck registration, scale
 * sessions, report filters, and stock location setup (B500B bay dedication).
 * Production-in / adjust inherit the class from the chosen bay.
 */
const READ_PERMISSIONS = [
  "salesorder.view",
  "scale.enter_session",
  "report.daily_trucks",
  "stock.view",
  "stock.location.manage",
  "stock.production.ton",
  "stock.production.bundle",
  "stock.opening_balance",
  "stock.transfer",
  "stock.adjust",
] as const;

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!READ_PERMISSIONS.some((p) => hasPermission(session, p)))
    return forbidden();

  try {
    const locale = await getRequestLocale();
    const rows = offeredSteelClassifications(await listActiveClassifications());
    // Localize the display name while keeping the stable `code` untouched.
    return ok(
      rows.map((c) => ({
        id: c.id,
        code: c.code,
        displayName: localizedClassification(c, locale),
        displayNameEn: c.displayNameEn,
        grade: c.grade,
      })),
    );
  } catch (e) {
    return handleServiceError(e);
  }
}
