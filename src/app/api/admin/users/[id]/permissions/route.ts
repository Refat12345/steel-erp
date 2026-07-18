import { NextRequest, NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { setUserPermissionsSchema } from "@/lib/validators/user-permissions";
import {
  getUserPermissionMatrix,
  setUserPermissionOverrides,
} from "@/lib/services/user-permission.service";

export async function GET(
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
    const matrix = await getUserPermissionMatrix(userId, session.role);
    return NextResponse.json({ success: true, data: matrix });
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function PUT(
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
  const parsed = setUserPermissionsSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    const matrix = await setUserPermissionOverrides(
      userId,
      parsed.data.permissions,
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
