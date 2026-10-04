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
import { searchDocumentUsers } from "@/lib/services/document.service";

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "document.manage")) return forbidden();

  const search = req.nextUrl.searchParams.get("search") ?? "";
  if (search.trim().length > 80) return badRequest("invalidParams");

  try {
    const users = await searchDocumentUsers(
      { userId: session.userId, permissions: session.permissions },
      search,
    );
    return ok(users);
  } catch (error) {
    return handleServiceError(error);
  }
}
