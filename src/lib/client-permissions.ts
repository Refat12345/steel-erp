import type { Session } from "next-auth";

/**
 * Client-side permission check for UI convenience (hiding buttons, sidebar
 * items, etc.). Mirrors the server `hasPermission` rule: permission-only,
 * no role-based bypasses.
 *
 * The `permissions` array in the session is the snapshot written into the
 * JWT at login; admin users receive every permission code at that moment,
 * so admin access naturally passes this check.
 *
 * This is UI sugar only. Never rely on it for security — the server-side
 * layers (middleware / layout / API) are the authoritative gates.
 */
export function sessionHasPermission(
  session: Session | null | undefined,
  code: string,
): boolean {
  if (!session?.user) return false;
  return session.user.permissions.includes(code);
}
