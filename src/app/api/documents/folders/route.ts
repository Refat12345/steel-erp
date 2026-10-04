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
import { folderCreateSchema, parsePositiveInt } from "@/lib/validators/document";
import { createFolder, listFolders } from "@/lib/services/document.service";

function actorFrom(session: { userId: number; permissions: string[] }) {
  return { userId: session.userId, permissions: session.permissions };
}

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "document.view") && !hasPermission(session, "document.manage")) {
    return forbidden();
  }

  const parentRaw = req.nextUrl.searchParams.get("parentId");
  let parentId: number | null = null;
  if (parentRaw) {
    parentId = parsePositiveInt(parentRaw);
    if (!parentId) return badRequest("invalidId");
  }

  try {
    return ok(await listFolders(actorFrom(session), parentId));
  } catch (error) {
    return handleServiceError(error);
  }
}

export async function POST(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "document.manage")) return forbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalidData");
  }

  const parsed = folderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || "invalidData");
  }

  try {
    const folder = await createFolder(actorFrom(session), parsed.data);
    return ok(folder);
  } catch (error) {
    return handleServiceError(error);
  }
}
