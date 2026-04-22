import { revalidateTag, unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";

/**
 * ─── Authorization Resolver ───────────────────────────────────────────
 *
 * The database is the single source of truth for both `roleCode` and
 * `isActive`. Callers authenticate via JWT to identify the user id, then
 * call `resolveUserAuth(userId)` which re-reads the full auth context
 * from the DB in a single query and memoises the result per-user.
 *
 * Callers MUST NOT pass a role from the JWT into this module — the
 * authoritative role is resolved internally. This prevents stale-admin
 * privilege retention after demotion, and guarantees deactivated users
 * lose access without needing to re-login.
 *
 * The cache TTL is comfortable (5 minutes) because mutations that affect
 * authorization (user role change, deactivation, override edits) call
 * `invalidateUserAuth(userId)` explicitly, which evicts the cache and
 * forces the next request to re-read from DB.
 * ─────────────────────────────────────────────────────────────────────
 */

const USER_AUTH_TTL_SECONDS = 300;
const ALL_PERMISSIONS_TTL_SECONDS = 300;

export interface UserAuthContext {
  userId: number;
  username: string;
  fullName: string;
  roleCode: string;
  permissions: Set<string>;
}

/** Per-user cache tag. Mutations that affect a single user's auth context call
 *  `invalidateUserAuth(userId)` which bumps this tag. */
export function userAuthCacheTag(userId: number): string {
  return `user-auth-${userId}`;
}

/** Evict the cached auth context for a user so the next request re-reads DB.
 *  Call after any mutation that changes role, isActive, or user permission overrides.
 *  `{ expire: 0 }` forces immediate expiry (Next.js 16 `revalidateTag` signature). */
export function invalidateUserAuth(userId: number): void {
  revalidateTag(userAuthCacheTag(userId), { expire: 0 });
}

// Full permission code list — changes rarely; shared cache for all admin sessions.
const getAllPermissionCodes = unstable_cache(
  async (): Promise<string[]> => {
    const rows = await prisma.permission.findMany({ select: { code: true } });
    return rows.map((r) => r.code);
  },
  ["permission-codes-all"],
  { revalidate: ALL_PERMISSIONS_TTL_SECONDS, tags: ["permission-codes-all"] },
);

interface CachedUserAuth {
  userId: number;
  username: string;
  fullName: string;
  roleCode: string;
  permissionCodes: string[];
}

/**
 * Single-query fetch: user row + role default permissions + user overrides,
 * resolved in one Postgres round trip. Returns null if the user doesn't
 * exist or is inactive.
 */
async function computeUserAuth(userId: number): Promise<CachedUserAuth | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      fullName: true,
      roleCode: true,
      isActive: true,
      permissionOverrides: {
        select: { permissionCode: true, overrideType: true },
      },
      role: {
        select: {
          defaultPermissions: { select: { permissionCode: true } },
        },
      },
    },
  });

  if (!user || !user.isActive) return null;

  let permissionCodes: string[];
  if (user.roleCode === "admin") {
    permissionCodes = await getAllPermissionCodes();
  } else {
    const set = new Set(
      user.role.defaultPermissions.map((d) => d.permissionCode),
    );
    for (const o of user.permissionOverrides) {
      if (o.overrideType === "grant") set.add(o.permissionCode);
      else if (o.overrideType === "revoke") set.delete(o.permissionCode);
    }
    permissionCodes = Array.from(set);
  }

  return {
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    roleCode: user.roleCode,
    permissionCodes,
  };
}

/**
 * Resolve the authoritative auth context for a user id.
 *
 * Reads everything needed for authorization (role, active status, effective
 * permissions) in one cached DB round trip. Returns `null` when the user
 * does not exist or has been deactivated — callers MUST treat that as
 * "no session".
 *
 * This is the ONLY entry point request-time code should use to answer
 * "what role does this user have and what can they do?".
 */
export async function resolveUserAuth(
  userId: number,
): Promise<UserAuthContext | null> {
  const tag = userAuthCacheTag(userId);
  const cached = await unstable_cache(
    () => computeUserAuth(userId),
    ["user-auth", String(userId)],
    { revalidate: USER_AUTH_TTL_SECONDS, tags: [tag] },
  )();

  if (!cached) return null;

  return {
    userId: cached.userId,
    username: cached.username,
    fullName: cached.fullName,
    roleCode: cached.roleCode,
    permissions: new Set(cached.permissionCodes),
  };
}

/**
 * Permission snapshot for the NextAuth `authorize()` callback only.
 *
 * At login we have JUST read the user row from DB (including `isActive`
 * and `roleCode`), so passing `roleCode` explicitly is safe — it has not
 * travelled through any JWT yet. Do not use this helper anywhere else.
 */
export async function getLoginPermissions(
  userId: number,
  roleCode: string,
): Promise<string[]> {
  if (roleCode === "admin") {
    return getAllPermissionCodes();
  }

  const [roleDefaults, overrides] = await Promise.all([
    prisma.roleDefaultPermission.findMany({
      where: { roleCode },
      select: { permissionCode: true },
    }),
    prisma.userPermissionOverride.findMany({
      where: { userId },
      select: { permissionCode: true, overrideType: true },
    }),
  ]);

  const permissions = new Set(roleDefaults.map((r) => r.permissionCode));
  for (const override of overrides) {
    if (override.overrideType === "grant") {
      permissions.add(override.permissionCode);
    } else if (override.overrideType === "revoke") {
      permissions.delete(override.permissionCode);
    }
  }

  return Array.from(permissions);
}
