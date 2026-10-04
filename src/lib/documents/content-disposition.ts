/**
 * HTTP headers must be ISO-8859-1 for legacy filename=; Arabic breaks Response in Node/Next.
 * Use an ASCII fallback plus RFC 5987 filename* for the real Unicode name.
 */
export function buildContentDisposition(fileName: string, inline: boolean): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "_") || "file";
  const star = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"),
  );
  const kind = inline ? "inline" : "attachment";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${star}`;
}
