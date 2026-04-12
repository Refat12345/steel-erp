import type { Session } from "next-auth";

/** Mirrors server `hasPermission` for client components using `useSession()`. */
export function sessionHasPermission(
  session: Session | null | undefined,
  code: string,
): boolean {
  if (!session?.user) return false;
  if (session.user.role === "admin") return true;
  return session.user.permissions.includes(code);
}
