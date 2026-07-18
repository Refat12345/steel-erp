import { NextRequest } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { attachmentUploadSchema } from "@/lib/validators/contract";
import { addAttachment } from "@/lib/services/contract.service";

interface Params {
  params: Promise<{ contractNumber: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "contract.edit")) return forbidden();

  const { contractNumber } = await params;

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("invalidData"); }

  const parsed = attachmentUploadSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "بيانات الملف ناقصة");
  }

  try {
    const attachment = await addAttachment(contractNumber, parsed.data, session.userId);
    return ok(attachment);
  } catch (e) {
    return handleServiceError(e);
  }
}
