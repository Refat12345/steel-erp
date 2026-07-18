/**
 * Bilingual display helper for reference data stored in the database
 * (destinations, sizes, roles, permissions, stock yards/locations).
 *
 * Phase 5 of the bilingual i18n plan added English columns
 * (`Destination.nameEn`, `SizeLookup.displayNameEn`, `Role.displayNameEn`,
 * `Permission.displayNameEn`, `StockYard.nameEn`, `StockLocation.nameEn`).
 * These columns are nullable: rows created before the migration (or through a
 * form that only captured the Arabic name) fall back to the Arabic value.
 *
 * Usage — pick the specific wrapper when possible so the field names stay
 * correct at the call site:
 *
 *   localizedDestination(destination, locale)
 *   localizedSize(size, locale)
 *   localizedRole(role, locale)
 *   localizedPermission(permission, locale)
 *
 * or the generic form for ad-hoc field pairs:
 *
 *   localizedName(entity, locale, { arField: "name", enField: "nameEn" })
 */

import type { Locale } from "@/i18n/config";

/**
 * Core rule: English locale prefers the English value when present and
 * non-empty, otherwise falls back to Arabic. Arabic locale always returns the
 * Arabic value. Returns an empty string only when both are missing.
 */
export function pickLocalizedName(
  locale: Locale,
  arValue: string | null | undefined,
  enValue: string | null | undefined,
): string {
  if (locale === "en") {
    const en = enValue?.trim();
    if (en) return en;
  }
  return arValue?.trim() ?? "";
}

/** Generic form: pass the field names for the Arabic and English columns. */
export function localizedName<T extends Record<string, unknown>>(
  entity: T | null | undefined,
  locale: Locale,
  fields: { arField: keyof T; enField: keyof T },
): string {
  if (!entity) return "";
  const ar = entity[fields.arField];
  const en = entity[fields.enField];
  return pickLocalizedName(
    locale,
    typeof ar === "string" ? ar : null,
    typeof en === "string" ? en : null,
  );
}

export function localizedDestination(
  destination: { name: string; nameEn?: string | null } | null | undefined,
  locale: Locale,
): string {
  if (!destination) return "";
  return pickLocalizedName(locale, destination.name, destination.nameEn);
}

export function localizedSize(
  size: { displayName: string; displayNameEn?: string | null } | null | undefined,
  locale: Locale,
): string {
  if (!size) return "";
  return pickLocalizedName(locale, size.displayName, size.displayNameEn);
}

export function localizedRole(
  role: { displayName: string; displayNameEn?: string | null } | null | undefined,
  locale: Locale,
): string {
  if (!role) return "";
  return pickLocalizedName(locale, role.displayName, role.displayNameEn);
}

export function localizedPermission(
  permission:
    | { displayName: string; displayNameEn?: string | null }
    | null
    | undefined,
  locale: Locale,
): string {
  if (!permission) return "";
  return pickLocalizedName(locale, permission.displayName, permission.displayNameEn);
}

/** Stock yards and locations store the Arabic name in `nameAr`. */
export function localizedStockName(
  entity: { nameAr: string; nameEn?: string | null } | null | undefined,
  locale: Locale,
): string {
  if (!entity) return "";
  return pickLocalizedName(locale, entity.nameAr, entity.nameEn);
}
