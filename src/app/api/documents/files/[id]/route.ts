import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  handleServiceError,
} from "@/lib/api-utils";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import { translateError } from "@/lib/i18n/server-messages";
import { logger } from "@/lib/logger";
import { buildContentDisposition } from "@/lib/documents/content-disposition";
import { documentDisplaysInline } from "@/lib/documents/file-signature";
import { parsePositiveInt } from "@/lib/validators/document";
import { hasDocumentReadAccess } from "@/lib/documents/access";
import { deleteSharedDocument, getSharedDocumentFile } from "@/lib/services/document.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function actorFrom(session: { userId: number; permissions: string[] }) {
  return { userId: session.userId, permissions: session.permissions };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getApiSession();
    if (!session) return unauthorized();
    if (!hasDocumentReadAccess(session.permissions)) return forbidden();

    const { id } = await params;
    const documentId = parsePositiveInt(id);
    if (!documentId) return badRequest("invalidId");

    const file = await getSharedDocumentFile(actorFrom(session), documentId);
    try {
      await stat(file.fullPath);
    } catch {
      const locale = await getRequestLocale();
      return NextResponse.json(
        { success: false, error: translateError(locale, "documentFileNotFound") },
        { status: 404 },
      );
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(file.fullPath);
    } catch (error) {
      logger.error({ err: error, documentId }, "shared document read failed");
      const locale = await getRequestLocale();
      return NextResponse.json(
        { success: false, error: translateError(locale, "fileReadFailed") },
        { status: 500 },
      );
    }

    const mode = req.nextUrl.searchParams.get("mode");
    const common = {
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };

    // Download managers (e.g. IDM) hijack any response that looks like a PDF,
    // including fetch() calls, so the in-page viewer gets raw bytes with no
    // file-like type or name.
    if (mode === "preview") {
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: { ...common, "Content-Type": "text/plain; charset=x-user-defined" },
      });
    }

    const inline = mode !== "download" && documentDisplaysInline(file.mimeType);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        ...common,
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": buildContentDisposition(file.fileName, inline),
      },
    });
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
  if (!hasDocumentReadAccess(session.permissions)) return forbidden();

  const { id } = await params;
  const documentId = parsePositiveInt(id);
  if (!documentId) return badRequest("invalidId");

  try {
    await deleteSharedDocument(actorFrom(session), documentId);
    return ok({ deleted: true });
  } catch (error) {
    return handleServiceError(error);
  }
}
