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
import { folderWriteSchema, parsePositiveInt } from "@/lib/validators/document";
import { hasDocumentReadAccess } from "@/lib/documents/access";
import { deleteFolder, getFolder, updateFolder } from "@/lib/services/document.service";

function actorFrom(session: { userId: number; permissions: string[] }) {
  return { userId: session.userId, permissions: session.permissions };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasDocumentReadAccess(session.permissions)) return forbidden();

  const { id } = await params;
  const folderId = parsePositiveInt(id);
  if (!folderId) return badRequest("invalidId");

  try {
    return ok(await getFolder(actorFrom(session), folderId));
  } catch (error) {
    return handleServiceError(error);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "document.manage")) return forbidden();

  const { id } = await params;
  const folderId = parsePositiveInt(id);
  if (!folderId) return badRequest("invalidId");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalidData");
  }

  const parsed = folderWriteSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    return ok(await updateFolder(actorFrom(session), folderId, parsed.data));
  } catch (error) {
    return handleServiceError(error);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "document.manage")) return forbidden();

  const { id } = await params;
  const folderId = parsePositiveInt(id);
  if (!folderId) return badRequest("invalidId");

  try {
    await deleteFolder(actorFrom(session), folderId);
    return ok({ deleted: true });
  } catch (error) {
    return handleServiceError(error);
  }
}
