import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getApiSession, unauthorized, badRequest, handleServiceError } from "@/lib/api-utils";
import { updateOwnLocale } from "@/lib/services/user.service";
import { LOCALES, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/i18n/config";

const bodySchema = z.object({
  locale: z.enum(LOCALES),
});

/**
 * Self-service language preference. Intentionally has no permission code:
 * the endpoint is authenticated and can only mutate the caller's OWN
 * `User.locale` — there is no cross-user or cross-entity reach, exactly
 * like a NextAuth session refresh.
 */
export async function PUT(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("طلب غير صالح");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("لغة غير مدعومة");
  }

  try {
    await updateOwnLocale(session.userId, parsed.data.locale);

    const res = NextResponse.json({ success: true, data: { locale: parsed.data.locale } });
    res.cookies.set(LOCALE_COOKIE, parsed.data.locale, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  } catch (e) {
    return handleServiceError(e);
  }
}
