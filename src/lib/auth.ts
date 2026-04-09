import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compareSync } from "bcryptjs";
import { prisma } from "@/lib/db";
import { getEffectivePermissions } from "@/lib/permissions";
import { logger } from "@/lib/logger";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "اسم المستخدم", type: "text" },
        password: { label: "كلمة المرور", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { username: credentials.username },
          include: { role: true },
        });

        if (!user || !user.isActive) {
          logger.warn({ username: credentials.username }, "login failed: user not found or inactive");
          return null;
        }

        const isValid = compareSync(credentials.password, user.passwordHash);
        if (!isValid) {
          logger.warn({ username: credentials.username }, "login failed: invalid password");
          return null;
        }

        const permissions = await getEffectivePermissions(
          user.id,
          user.roleCode
        );

        logger.info({ userId: user.id, username: user.username, role: user.roleCode }, "login successful");

        return {
          id: String(user.id),
          name: user.fullName,
          username: user.username,
          role: user.roleCode,
          roleName: user.role.displayName,
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
        token.permissions = user.permissions;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.userId as number;
      session.user.username = token.username as string;
      session.user.role = token.role as string;
      session.user.roleName = token.roleName as string;
      session.user.permissions = token.permissions as string[];
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
