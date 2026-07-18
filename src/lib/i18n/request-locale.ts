/**
 * Node-only request locale helper (uses next/headers).
 * Do not import this from Edge middleware — use cookie value +
 * resolveLocaleFromCookieValue from server-messages instead.
 */

import { cookies } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "@/i18n/config";
import { resolveLocaleFromCookieValue } from "@/lib/i18n/server-messages";

export async function getRequestLocale(): Promise<Locale> {
  const store = await cookies();
  return resolveLocaleFromCookieValue(store.get(LOCALE_COOKIE)?.value);
}
