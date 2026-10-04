import path from "path";

/** Stored library files live under uploads/documents/{folderId}/. */
export const DOCUMENT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export type DocumentExtension =
  | "pdf"
  | "jpg"
  | "png"
  | "webp"
  | "doc"
  | "docx"
  | "xls"
  | "xlsx";

const MIME_BY_EXTENSION: Record<DocumentExtension, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const INLINE_EXTENSIONS = new Set<DocumentExtension>(["pdf", "jpg", "png", "webp"]);

export function documentMimeType(extension: DocumentExtension): string {
  return MIME_BY_EXTENSION[extension];
}

export function documentOpensInline(extension: DocumentExtension): boolean {
  return INLINE_EXTENSIONS.has(extension);
}

/** PDF and images can be shown in the page. Office files cannot. */
export function documentDisplaysInline(mimeType: string): boolean {
  return mimeType === "application/pdf" || mimeType.startsWith("image/");
}

export function extensionFromStoredName(fileName: string): DocumentExtension | null {
  const ext = path.extname(fileName).toLowerCase().replace(/^\./, "");
  if (ext === "jpeg") return "jpg";
  if (ext in MIME_BY_EXTENSION) return ext as DocumentExtension;
  return null;
}

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 1024).includes(Buffer.from("%PDF"));
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  );
}

function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  );
}

function isZip(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
  );
}

function isOle(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  );
}

function signatureMatches(extension: DocumentExtension, buffer: Buffer): boolean {
  switch (extension) {
    case "pdf":
      return isPdf(buffer);
    case "jpg":
      return isJpeg(buffer);
    case "png":
      return isPng(buffer);
    case "webp":
      return isWebp(buffer);
    case "doc":
    case "xls":
      return isOle(buffer);
    case "docx":
      return isZip(buffer) && buffer.includes(Buffer.from("word/"));
    case "xlsx":
      return isZip(buffer) && buffer.includes(Buffer.from("xl/"));
    default:
      return false;
  }
}

/**
 * Accept a file only when its extension and its bytes agree.
 * Office XML formats are both ZIP; the extension plus an internal path
 * (`word/` or `xl/`) tells them apart.
 */
export function detectDocumentFile(
  buffer: Buffer,
  originalName: string,
): { extension: DocumentExtension; mimeType: string } | null {
  const extension = extensionFromStoredName(originalName);
  if (!extension) return null;
  if (!signatureMatches(extension, buffer)) return null;
  return { extension, mimeType: documentMimeType(extension) };
}

/** Display name stored in the database. Never used as the on-disk name. */
export function sanitizeOriginalFileName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.replace(/[\u0000-\u001f]/g, "").trim() || "file";
  return base.slice(0, 255);
}
