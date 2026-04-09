/**
 * Relative path inside `uploads/` from a stored value like "uploads/foo.pdf".
 */
export function buildUploadedFileRelativePath(storedPath: string): string {
  return storedPath
    .replace(/\\/g, "/")
    .replace(/^uploads\/?/i, "")
    .replace(/^\/+/, "");
}

/** Browser-safe UTF-8 → base64url (no dependency on Node Buffer). */
function utf8ToBase64Url(s: string): string {
  const u8 = new TextEncoder().encode(s);
  let bin = "";
  for (const byte of u8) {
    bin += String.fromCharCode(byte);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Fetch uploaded file via `/api/files/view?p=…` (avoids broken catch-all routes with Arabic filenames).
 */
export function fetchUploadedFile(storedPath: string): Promise<Response> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Client only"));
  }
  const rel = buildUploadedFileRelativePath(storedPath);
  if (!rel) {
    return Promise.reject(new Error("Empty path"));
  }
  const p = utf8ToBase64Url(rel);
  const url = `${window.location.origin}/api/files/view?p=${encodeURIComponent(p)}`;
  return fetch(url, { credentials: "include", cache: "no-store" });
}
