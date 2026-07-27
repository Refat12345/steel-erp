import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "./config";

/**
 * Request-scoped next-intl configuration ("without i18n routing" mode).
 *
 * The locale comes from the NEXT_LOCALE cookie only — URLs are never
 * localized, so existing links and the RBAC middleware stay untouched.
 * The cookie is written by /api/locale (anonymous, cookie only — e.g. login)
 * or /api/user/locale (authenticated — also persists User.locale).
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieValue = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: "Asia/Damascus",
  };
});
