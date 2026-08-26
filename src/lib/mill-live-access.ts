/**
 * Temporary allowlist for the mill live dashboard.
 *
 * Controlled by `MILL_LIVE_DASHBOARD_USERS` (comma-separated usernames).
 * Intended as a short-lived gate until a proper RBAC permission replaces it.
 * Empty / unset → nobody can access, except users who can edit the
 * mill-live product size (`settings.edit`) so an admin can always open
 * the page and pick the displayed size.
 */

/** Permission that may change the mill-live product size (admin catalog). */
export const MILL_LIVE_SIZE_EDIT_PERMISSION = "settings.edit";

function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function canAccessMillLiveDashboard(username: string | null | undefined): boolean {
  if (!username?.trim()) return false;
  const allowlist = parseAllowlist(process.env.MILL_LIVE_DASHBOARD_USERS);
  if (allowlist.size === 0) return false;
  return allowlist.has(username.trim().toLowerCase());
}

export function canEditMillLiveProductSize(
  permissions: readonly string[] | null | undefined,
): boolean {
  return Boolean(permissions?.includes(MILL_LIVE_SIZE_EDIT_PERMISSION));
}

/** Page / API gate: env allowlist OR size-edit permission. */
export function canOpenMillLiveDashboard(input: {
  username?: string | null;
  permissions?: readonly string[] | null;
}): boolean {
  return (
    canAccessMillLiveDashboard(input.username) ||
    canEditMillLiveProductSize(input.permissions)
  );
}
