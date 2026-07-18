import { NextRequest, NextResponse } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  handleServiceError,
  parsePagination,
} from "@/lib/api-utils";
import { contractCreateWithAttachmentSchema } from "@/lib/validators/contract";
import { listContracts, createContract } from "@/lib/services/contract.service";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "contract.view")) return forbidden();

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "";
  const pagination = parsePagination(searchParams);

  try {
    const result = await listContracts(search, status, pagination);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function POST(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "contract.create")) return forbidden();

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("invalidData"); }

  const parsed = contractCreateWithAttachmentSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  const { customerId, notes, attachmentPath, attachmentName, attachmentSize } = parsed.data;

  try {
    const contract = await createContract(
      { customerId, notes },
      { path: attachmentPath, name: attachmentName, size: attachmentSize },
      session.userId,
    );
    return ok(contract);
  } catch (e) {
    return handleServiceError(e);
  }
}
