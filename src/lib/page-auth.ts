import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectivePermissions } from "@/lib/permissions";
import { logger } from "@/lib/logger";

interface PageSession {
  userId: number;
  username: string;
  role: string;
  permissions: Set<string>;
}

async function getPageSession(): Promise<PageSession | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;

  const userId = session.user.id as number;
  const role = session.user.role as string;
  const permissions = await getEffectivePermissions(userId, role);

  return {
    userId,
    username: session.user.username as string,
    role,
    permissions,
  };
}

/**
 * Server-side page guard. Call at the top of any protected page component.
 * Accepts one or more permission codes (OR logic: user needs at least one).
 * Redirects to /forbidden if unauthorized.
 */
export async function requirePagePermission(
  ...requiredPermissions: string[]
): Promise<PageSession> {
  const session = await getPageSession();

  if (!session) {
    redirect("/login");
  }

  if (session.role === "admin") {
    return session;
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
        required: requiredPermissions,
      },
      "page access denied — missing permission",
    );
    redirect("/forbidden");
  }

  return session;
}

/**
 * Require admin role for a page.
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
