/**
 * Locale-aware message lookup for API routes and Edge middleware.
 *
 * Uses the NEXT_LOCALE cookie (same source as next-intl request config).
 * Keeps a tiny ICU-lite interpolator so middleware (Edge) does not need
 * the full next-intl runtime for a handful of error strings.
 *
 * This module must stay Edge-safe: no `next/headers` imports.
 */

import {
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
} from "@/i18n/config";
import arMessages from "../../../messages/ar.json";
import enMessages from "../../../messages/en.json";

type MessageTree = Record<string, unknown>;

const CATALOG: Record<Locale, MessageTree> = {
  ar: arMessages as MessageTree,
  en: enMessages as MessageTree,
};

export type TranslateParams = Record<
  string,
  string | number | boolean | Date | null | undefined
>;

export function resolveLocaleFromCookieValue(
  cookieValue: string | undefined | null,
): Locale {
  return isLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;
}

function lookup(tree: MessageTree, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = tree;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as MessageTree)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

/** Replace `{name}` placeholders (next-intl-compatible, no plural/select). */
export function interpolate(
  template: string,
  params?: TranslateParams,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    if (value == null) return "";
    if (value instanceof Date) return value.toISOString();
    return String(value);
  });
}

/**
 * Translate `namespace.key` (or a bare key under `namespace`) for a locale.
 * Returns the key itself when missing so callers never crash on typos.
 */
export function translateMessage(
  locale: Locale,
  namespace: string,
  key: string,
  params?: TranslateParams,
): string {
  const bare = key.startsWith(`${namespace}.`)
    ? key.slice(namespace.length + 1)
    : key;
  const template =
    lookup(CATALOG[locale], `${namespace}.${bare}`) ??
    lookup(CATALOG[DEFAULT_LOCALE], `${namespace}.${bare}`);
  if (!template) return bare;
  return interpolate(template, params);
}

export function translateError(
  locale: Locale,
  key: string,
  params?: TranslateParams,
): string {
  return translateMessage(locale, "errors", key, params);
}

export function translateValidation(
  locale: Locale,
  key: string,
  params?: TranslateParams,
): string {
  return translateMessage(locale, "validation", key, params);
}

/**
 * Resolve a Zod / API error string: prefer `validation.*`, then `errors.*`,
 * then return the raw string (already-translated legacy or plain text).
 */
export function resolveApiErrorMessage(
  locale: Locale,
  keyOrMessage: string,
  params?: TranslateParams,
): string {
  const bareValidation = keyOrMessage.startsWith("validation.")
    ? keyOrMessage.slice("validation.".length)
    : keyOrMessage;
  const bareErrors = keyOrMessage.startsWith("errors.")
    ? keyOrMessage.slice("errors.".length)
    : keyOrMessage;

  const fromValidation =
    lookup(CATALOG[locale], `validation.${bareValidation}`) ??
    lookup(CATALOG[DEFAULT_LOCALE], `validation.${bareValidation}`);
  if (fromValidation) return interpolate(fromValidation, params);

  const fromErrors =
    lookup(CATALOG[locale], `errors.${bareErrors}`) ??
    lookup(CATALOG[DEFAULT_LOCALE], `errors.${bareErrors}`);
  if (fromErrors) return interpolate(fromErrors, params);

  return keyOrMessage;
}
