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
import { parsePositiveInt, setFolderMembersSchema } from "@/lib/validators/document";
import { listFolderMembers, setFolderMembers } from "@/lib/services/document.service";

function actorFrom(session: { userId: number; permissions: string[] }) {
  return { userId: session.userId, permissions: session.permissions };
}

export async function GET(
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
    return ok(await listFolderMembers(actorFrom(session), folderId));
  } catch (error) {
    return handleServiceError(error);
  }
}

export async function PUT(
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

  const parsed = setFolderMembersSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    return ok(await setFolderMembers(actorFrom(session), folderId, parsed.data.members));
  } catch (error) {
    return handleServiceError(error);
  }
}
