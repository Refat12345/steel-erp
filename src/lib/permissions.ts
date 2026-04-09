import { prisma } from "@/lib/db";

/**
 * Compute effective permissions for a user.
 * Admin role always gets ALL permissions.
 * Others get: role defaults + granted overrides - revoked overrides.
 */
export async function getEffectivePermissions(
  userId: number,
  roleCode: string
): Promise<Set<string>> {
  if (roleCode === "admin") {
    const allPerms = await prisma.permission.findMany({
      select: { code: true },
    });
    return new Set(allPerms.map((p) => p.code));
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

  return permissions;
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
