import path from "path";

/**
 * True when a stored upload path points at the shared library.
 * The generic file viewer must refuse these paths: it authorizes by
 * contract/truck/billet permissions, which must not open library files.
 */
export function isSharedLibraryRelativePath(relFromDb: string): boolean {
  const rel = relFromDb
    .replace(/\\/g, "/")
    .replace(/^uploads\/?/i, "")
    .replace(/^\/+/, "");
  const first = rel.split("/").filter(Boolean)[0];
  return first?.toLowerCase() === "documents";
}

/**
 * Resolve a library file that the database says lives in this folder.
 * Rejects anything outside uploads/documents/{folderId}/.
 */
export function resolveStoredDocumentPath(filePath: string, folderId: number): string | null {
  const rel = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const prefix = `uploads/documents/${folderId}/`;
  if (!rel.startsWith(prefix)) return null;

  const fileName = rel.slice(prefix.length);
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    return null;
  }

  const folderRoot = path.resolve(process.cwd(), "uploads", "documents", String(folderId));
  const fullPath = path.resolve(folderRoot, fileName);
  const relative = path.relative(folderRoot, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return fullPath;
}
