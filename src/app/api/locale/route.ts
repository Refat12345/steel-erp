import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { badRequest } from "@/lib/api-utils";
import { LOCALES, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/i18n/config";

const bodySchema = z.object({
  locale: z.enum(LOCALES),
});

/**
 * Public (unauthenticated) locale preference — cookie only.
 * Used on /login before a session exists. Authenticated users should prefer
 * PUT /api/user/locale so User.locale is persisted too.
 */
export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalidRequest");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("unsupportedLocale");
  }

  const res = NextResponse.json({
    success: true,
    data: { locale: parsed.data.locale },
  });
  res.cookies.set(LOCALE_COOKIE, parsed.data.locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
