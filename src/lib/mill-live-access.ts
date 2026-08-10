/**
 * Temporary allowlist for the mill live dashboard.
 *
 * Controlled by `MILL_LIVE_DASHBOARD_USERS` (comma-separated usernames).
 * Intended as a short-lived gate until a proper RBAC permission replaces it.
 * Empty / unset → nobody can access.
 */

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
