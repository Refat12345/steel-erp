import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
import {
  getApiSession,
  hasPermission,
  unauthorized,
  forbidden,
  badRequest,
  handleServiceError,
} from "@/lib/api-utils";
import { logger } from "@/lib/logger";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import { translateError } from "@/lib/i18n/server-messages";

const MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/**
 * HTTP headers must be ISO-8859-1 for legacy filename=; Arabic breaks Response in Node/Next → 500.
 * Use ASCII fallback + RFC 5987 filename* for real Unicode name.
 */
function buildContentDispositionInline(fileName: string): string {
  const ascii =
    fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "_") || "file";
  const star = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")
  );
  return `inline; filename="${ascii}"; filename*=UTF-8''${star}`;
}

function resolveSafeUploadPath(relFromDb: string): { fullPath: string } | null {
  const rel = relFromDb
    .replace(/\\/g, "/")
    .replace(/^uploads\/?/i, "")
    .replace(/^\/+/, "");
  const segments = rel.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  for (const seg of segments) {
    if (
      !seg ||
      seg === "." ||
      seg === ".." ||
      seg.includes("..") ||
      seg.includes("/") ||
      seg.includes("\\")
    ) {
      return null;
    }
  }

  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const fullPath = path.resolve(uploadsRoot, ...segments);
  const relativeToUploads = path.relative(uploadsRoot, fullPath);
  if (
    relativeToUploads.startsWith("..") ||
    path.isAbsolute(relativeToUploads)
  ) {
    return null;
  }
  return { fullPath };
}

export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession();
    if (!session) return unauthorized();
    if (
      !hasPermission(session, "contract.view") &&
      !hasPermission(session, "truck.view_approved") &&
      !hasPermission(session, "scale.upload_photo") &&
      !hasPermission(session, "billet.contract.view") &&
      !hasPermission(session, "billet.receipt.view")
    ) {
      return forbidden();
    }

    const p = req.nextUrl.searchParams.get("p");
    if (!p?.trim()) return badRequest("invalidPath");

    let relativeUtf8: string;
    try {
      relativeUtf8 = Buffer.from(p, "base64url").toString("utf8");
    } catch {
      return badRequest("invalidPath");
    }

    const resolved = resolveSafeUploadPath(relativeUtf8);
    if (!resolved) return badRequest("invalidPath");

    const { fullPath } = resolved;

    try {
      await stat(fullPath);
    } catch {
      const locale = await getRequestLocale();
      return NextResponse.json(
        { success: false, error: translateError(locale, "fileNotFound") },
        { status: 404 },
      );
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";
    let buffer: Buffer;
    try {
      buffer = await readFile(fullPath);
    } catch {
      const locale = await getRequestLocale();
      return NextResponse.json(
        { success: false, error: translateError(locale, "fileReadFailed") },
        { status: 500 },
      );
    }

    const body = new Uint8Array(buffer);
    const baseName = path.basename(fullPath);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": buildContentDispositionInline(baseName),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    logger.error({ err: e }, "file view failed");
    return handleServiceError(e);
  }
}
