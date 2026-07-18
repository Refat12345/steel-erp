import { NextRequest, NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { resetPasswordSchema } from "@/lib/validators/user";
import { resetPassword } from "@/lib/services/user.service";

export async function POST(
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
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    await resetPassword(userId, parsed.data.newPassword, session.userId);
    return NextResponse.json({ success: true, data: { message: "تم تغيير كلمة المرور بنجاح" } });
  } catch (e) {
    return handleServiceError(e);
  }
}
