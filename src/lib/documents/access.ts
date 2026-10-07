/** Permissions that may open the documents module. Folder contents are narrower. */
export const DOCUMENT_READ_PERMISSIONS = [
  "document.view",
  "document.view_all",
  "document.manage",
] as const;

export function hasDocumentReadAccess(permissions: readonly string[]): boolean {
  return DOCUMENT_READ_PERMISSIONS.some((code) => permissions.includes(code));
}
