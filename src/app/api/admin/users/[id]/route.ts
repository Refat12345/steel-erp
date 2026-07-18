import { NextRequest, NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { updateUserSchema } from "@/lib/validators/user";
import { getUserById, updateUser } from "@/lib/services/user.service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "user.manage")) return forbidden();

  const { id } = await params;
  const userId = parseInt(id, 10);
  if (isNaN(userId)) return badRequest("invalidId");

  try {
    const user = await getUserById(userId);
    return NextResponse.json({ success: true, data: user });
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "user.manage")) return forbidden();

  const { id } = await params;
  const userId = parseInt(id, 10);
  if (isNaN(userId)) return badRequest("invalidId");

  const body = await req.json();
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    const user = await updateUser(userId, parsed.data, session.userId);
    return NextResponse.json({ success: true, data: user });
  } catch (e) {
    return handleServiceError(e);
  }
}
