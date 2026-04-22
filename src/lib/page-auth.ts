import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveUserAuth } from "@/lib/permissions";
import { getRoleLandingPage } from "@/lib/rbac-policy";
import { logger } from "@/lib/logger";

interface PageSession {
  userId: number;
  username: string;
  role: string;
  permissions: Set<string>;
}

/**
 * Server-side page session resolver.
 *
 * The JWT supplies only the user id. Role, active status and permissions
 * are re-read from the database (short cache window), so any admin
 * change propagates without requiring re-login. Returns `null` when the
 * user has been deleted or deactivated.
 */
async function getPageSession(): Promise<PageSession | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;

  const userId = session.user.id as number | undefined;
  if (typeof userId !== "number") return null;

  const authContext = await resolveUserAuth(userId);
  if (!authContext) return null;

  return {
    userId: authContext.userId,
    username: authContext.username,
    role: authContext.roleCode,
    permissions: authContext.permissions,
  };
}

/**
 * Server-side page guard. Call at the top of any protected page component.
 * Accepts one or more permission codes (OR logic: user needs at least one).
 * Redirects to /forbidden if unauthorized.
 *
 * Admin users inherit every permission code via `resolveUserAuth`, so no
 * role-based bypass is needed here — the permission set is the only gate.
 */
export async function requirePagePermission(
  ...requiredPermissions: string[]
): Promise<PageSession> {
  const session = await getPageSession();

  if (!session) {
    redirect("/login");
  }

  if (requiredPermissions.length === 0) {
    return session;
  }

  const hasAny = requiredPermissions.some((p) => session.permissions.has(p));
  if (!hasAny) {
    logger.warn(
      {
        userId: session.userId,
        username: session.username,
        roleCode: session.role,
        required: requiredPermissions,
      },
      "page access denied — missing permission",
    );
    // Prefer the role's configured landing page (e.g. shop-floor and
    // logistics roles land on /trucks) so login never ends on a
    // dead-end /forbidden screen for a legitimate worker. Fall back
    // to /forbidden when no landing page is mapped.
    redirect(getRoleLandingPage(session.role) ?? "/forbidden");
  }

  return session;
}

/**
 * Require admin role for a page. `session.role` here is resolved from
 * the DB (not the JWT), so a user demoted in the database will be
 * redirected to /forbidden within the user-identity cache window.
 */
export async function requireAdmin(): Promise<PageSession> {
  const session = await getPageSession();

  if (!session) {
    redirect("/login");
  }

  if (session.role !== "admin") {
    logger.warn(
      { userId: session.userId, username: session.username },
      "admin page access denied",
    );
    redirect("/forbidden");
  }

  return session;
}
