import { NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { listRoles } from "@/lib/services/user.service";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import { localizedRole } from "@/lib/localized-name";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "user.manage")) return forbidden();

  try {
    const locale = await getRequestLocale();
    const roles = await listRoles();
    return NextResponse.json({
      success: true,
      data: roles.map((r) => ({
        code: r.code,
        displayName: localizedRole(r, locale),
      })),
    });
  } catch (e) {
    return handleServiceError(e);
  }
}
