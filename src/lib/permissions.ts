import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";

/**
 * Full permission code list — changes rarely; shared by all admin sessions.
 * Avoids scanning `permission` on every single API request for admin users.
 */
const getAllPermissionCodes = unstable_cache(
  async (): Promise<string[]> => {
    const rows = await prisma.permission.findMany({ select: { code: true } });
    return rows.map((r) => r.code);
  },
  ["permission-codes-all"],
  { revalidate: 300 }
);

async function computeEffectivePermissions(
  userId: number,
  roleCode: string
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

/**
 * Effective permissions for a user — cached ~60s per user/role to avoid a DB hit
 * on every API call (previously `getApiSession` queried on each request).
 * After admin changes overrides, updates apply within the cache window (or next login from JWT).
 */
export async function getEffectivePermissions(
  userId: number,
  roleCode: string
): Promise<Set<string>> {
  const key =
    roleCode === "admin"
      ? (["effective-permissions", "admin"] as const)
      : (["effective-permissions", String(userId), roleCode] as const);

  const codes = await unstable_cache(
    async () => computeEffectivePermissions(userId, roleCode),
    [...key],
    { revalidate: 60 }
  )();

  return new Set(codes);
}

/**
 * Check if a user has a specific permission.
 */
export async function hasPermission(
  userId: number,
  roleCode: string,
  permissionCode: string
): Promise<boolean> {
  const permissions = await getEffectivePermissions(userId, roleCode);
  return permissions.has(permissionCode);
}
