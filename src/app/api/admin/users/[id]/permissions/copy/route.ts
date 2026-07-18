import { NextRequest, NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { copyUserPermissionsSchema } from "@/lib/validators/user-permissions";
import { copyUserPermissionOverrides } from "@/lib/services/user-permission.service";
import { getRequestLocale } from "@/lib/i18n/request-locale";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "user.set_permissions")) return forbidden();

  const { id } = await params;
  const userId = parseInt(id, 10);
  if (isNaN(userId)) return badRequest("invalidId");

  const body = await req.json();
  const parsed = copyUserPermissionsSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    const locale = await getRequestLocale();
    const matrix = await copyUserPermissionOverrides(
      userId,
      parsed.data.sourceUserId,
      session.userId,
      session.role,
      locale,
    );
    return NextResponse.json({
      success: true,
      data: matrix,
      warnings: matrix.warnings,
    });
  } catch (e) {
    return handleServiceError(e);
  }
}
