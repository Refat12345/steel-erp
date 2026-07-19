import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { getLoginPermissions } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { checkRateLimit, LOGIN_RATE_LIMIT } from "@/lib/rate-limit";

/**
 * Extract the best-effort client IP from a request's headers. Falls back to
 * "unknown" so the rate limiter still has a bucket (attackers behind a shared
 * proxy still hit the per-user bucket anyway).
 */
function extractIp(headers: Headers | Record<string, string | string[] | undefined> | undefined): string {
  if (!headers) return "unknown";

  const get = (key: string): string | null => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(key);
    }
    const v = (headers as Record<string, string | string[] | undefined>)[key]
      ?? (headers as Record<string, string | string[] | undefined>)[key.toLowerCase()];
    if (Array.isArray(v)) return v[0] ?? null;
    return v ?? null;
  };

  const forwardedFor = get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "unknown";
  return get("x-real-ip") || get("cf-connecting-ip") || "unknown";
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "اسم المستخدم", type: "text" },
        password: { label: "كلمة المرور", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        // ── Brute-force protection (Part 6) ─────────────────────────
        // Count every login attempt — successful or not — against BOTH the
        // username bucket and the source-IP bucket. Exceeding either throws
        // a labelled error that NextAuth surfaces to /login?error=...
        const username = credentials.username.toLowerCase().trim();
        const ip = extractIp(req?.headers);
        const userCheck = checkRateLimit(`login:user:${username}`, LOGIN_RATE_LIMIT);
        const ipCheck = checkRateLimit(`login:ip:${ip}`, LOGIN_RATE_LIMIT);
        if (!userCheck.allowed || !ipCheck.allowed) {
          logger.warn(
            { username, ip, userRetryMs: userCheck.retryAfterMs, ipRetryMs: ipCheck.retryAfterMs },
            "login rate-limited",
          );
          // NextAuth forwards `Error.message` to the client as the `error`
          // query param on the sign-in page. The login page translates this
          // into the user-facing "429 Too Many Requests" message.
          throw new Error("TOO_MANY_REQUESTS");
        }

        const user = await prisma.user.findUnique({
          where: { username },
          include: { role: true },
        });

        if (!user || !user.isActive) {
          logger.warn({ username }, "login failed: user not found or inactive");
          return null;
        }

        // Async bcrypt.compare avoids blocking the Node.js event loop during
        // the ~100 ms hash verification — important under concurrent login
        // bursts (e.g. after a shift change) where many operators sign in
        // within a few seconds.
        const isValid = await compare(credentials.password, user.passwordHash);
        if (!isValid) {
          logger.warn({ username }, "login failed: invalid password");
          return null;
        }

        const permissions = await getLoginPermissions(
          user.id,
          user.roleCode,
        );

        logger.info({ userId: user.id, username: user.username, role: user.roleCode }, "login successful");

        return {
          id: String(user.id),
          name: user.fullName,
          username: user.username,
          role: user.roleCode,
          roleName: user.role.displayName,
          roleNameEn: user.role.displayNameEn ?? null,
          permissions: Array.from(permissions),
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = Number(user.id);
        token.username = user.username;
        token.role = user.role;
        token.roleName = user.roleName;
        token.roleNameEn = user.roleNameEn;
        token.permissions = user.permissions;
      } else if (token.role && token.roleNameEn === undefined) {
        // Backfill English role label for sessions issued before roleNameEn
        // was added to the JWT (one DB read, then cached on the token).
        const role = await prisma.role.findUnique({
          where: { code: token.role as string },
          select: { displayName: true, displayNameEn: true },
        });
        if (role) {
          token.roleName = role.displayName;
          token.roleNameEn = role.displayNameEn ?? null;
        } else {
          token.roleNameEn = null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.userId as number;
      session.user.username = token.username as string;
      session.user.role = token.role as string;
      session.user.roleName = token.roleName as string;
      session.user.roleNameEn = (token.roleNameEn as string | null | undefined) ?? null;
      session.user.permissions = token.permissions as string[];
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
