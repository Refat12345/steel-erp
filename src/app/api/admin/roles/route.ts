import { NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { listRoles } from "@/lib/services/user.service";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "user.manage")) return forbidden();

  try {
    const roles = await listRoles();
    return NextResponse.json({ success: true, data: roles });
  } catch (e) {
    return handleServiceError(e);
  }
}
