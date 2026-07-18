import { NextRequest, NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { resetUserPermissionOverrides } from "@/lib/services/user-permission.service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "user.set_permissions")) return forbidden();

  const { id } = await params;
  const userId = parseInt(id, 10);
  if (isNaN(userId)) return badRequest("invalidId");

  try {
    const matrix = await resetUserPermissionOverrides(
      userId,
      session.userId,
      session.role,
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
