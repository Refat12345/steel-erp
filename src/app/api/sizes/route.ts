import {
  getApiSession,
  unauthorized,
  forbidden,
  ok,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { listActiveSizes } from "@/lib/services/size-lookup.service";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import { localizedSize } from "@/lib/localized-name";

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
    const locale = await getRequestLocale();
    const rows = await listActiveSizes();
    // Localize the display name while keeping the stable `code` untouched.
    return ok(
      rows.map((s) => ({
        id: s.id,
        code: s.code,
        displayName: localizedSize(s, locale),
        displayNameEn: s.displayNameEn,
        isBundleType: s.isBundleType,
        isSpecialRatio: s.isSpecialRatio,
      })),
    );
  } catch (e) {
    return handleServiceError(e);
  }
}
