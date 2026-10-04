import { NextRequest } from "next/server";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
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
import { documentMetaSchema, parsePositiveInt } from "@/lib/validators/document";
import {
  DOCUMENT_UPLOAD_MAX_BYTES,
  detectDocumentFile,
} from "@/lib/documents/file-signature";
import {
  assertCanUpload,
  createSharedDocument,
  listFolderFiles,
} from "@/lib/services/document.service";

function actorFrom(session: { userId: number; permissions: string[] }) {
  return { userId: session.userId, permissions: session.permissions };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "document.view") && !hasPermission(session, "document.manage")) {
    return forbidden();
  }

  const { id } = await params;
  const folderId = parsePositiveInt(id);
  if (!folderId) return badRequest("invalidId");

  const search = req.nextUrl.searchParams.get("search") ?? "";
  if (search.length > 120) return badRequest("invalidParams");

  try {
    return ok(
      await listFolderFiles(actorFrom(session), folderId, search, parsePagination(req.nextUrl.searchParams)),
    );
  } catch (error) {
    return handleServiceError(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "document.view") && !hasPermission(session, "document.manage")) {
    return forbidden();
  }

  const { id } = await params;
  const folderId = parsePositiveInt(id);
  if (!folderId) return badRequest("invalidId");

  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const length = parseInt(contentLength, 10);
    if (Number.isFinite(length) && length > DOCUMENT_UPLOAD_MAX_BYTES + 64 * 1024) {
      return badRequest("fileTooLarge10Mb");
    }
  }

  const actor = actorFrom(session);
  try {
    await assertCanUpload(actor, folderId);
  } catch (error) {
    return handleServiceError(error);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return badRequest("invalidData");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return badRequest("fileNotSelected");
  if (file.size <= 0) return badRequest("fileNotSelected");
  if (file.size > DOCUMENT_UPLOAD_MAX_BYTES) return badRequest("fileTooLarge10Mb");

  const meta = documentMetaSchema.safeParse({
    title: typeof formData.get("title") === "string" ? formData.get("title") : "",
    notes: typeof formData.get("notes") === "string" ? formData.get("notes") : "",
  });
  if (!meta.success) {
    return badRequest(meta.error.issues[0]?.message || "invalidData");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = detectDocumentFile(buffer, file.name);
  if (!detected) return badRequest("documentFileTypeNotAllowed");

  const dir = path.join(process.cwd(), "uploads", "documents", String(folderId));
  await mkdir(dir, { recursive: true });
  const storedName = `${randomUUID()}.${detected.extension}`;
  const absolutePath = path.join(dir, storedName);
  const relativePath = `uploads/documents/${folderId}/${storedName}`;
  await writeFile(absolutePath, buffer);

  try {
    const created = await createSharedDocument(
      actor,
      folderId,
      {
        filePath: relativePath,
        fileName: file.name,
        fileSize: buffer.length,
        mimeType: detected.mimeType,
      },
      meta.data,
    );
    return ok(created);
  } catch (error) {
    await unlink(absolutePath).catch(() => {});
    return handleServiceError(error);
  }
}
