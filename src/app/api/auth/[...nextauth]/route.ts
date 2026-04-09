import { NextRequest, NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const LOGIN_RATE_LIMIT = { windowMs: 15 * 60 * 1000, maxAttempts: 10 };

const handler = NextAuth(authOptions);

export { handler as GET };

export async function POST(req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) {
  const segments = await ctx.params;
  const isSignIn =
    segments.nextauth?.includes("signin") ||
    segments.nextauth?.includes("callback");

  if (isSignIn) {
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || "unknown";
    const result = checkRateLimit(`login:${ip}`, LOGIN_RATE_LIMIT);

    if (!result.allowed) {
      logger.warn({ ip }, "login rate limited");
      return NextResponse.json(
        { error: "عدد المحاولات تجاوز الحد المسموح، حاول لاحقاً" },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)) },
        },
      );
    }
  }

  return handler(req, { params: segments });
}
