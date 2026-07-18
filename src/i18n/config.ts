/**
 * i18n configuration — single source of truth for supported locales.
 *
 * The app uses next-intl WITHOUT i18n routing: URLs never contain a locale
 * segment. The active locale is resolved per-request from the NEXT_LOCALE
 * cookie (see src/i18n/request.ts), falling back to Arabic.
 */

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ar";

/** Cookie read by getRequestConfig on every request (server-side). */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** One year — the preference is also persisted in User.locale. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function getTextDirection(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
