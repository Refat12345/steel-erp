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

export function localizedClassification(
  classification:
    | { displayName: string; displayNameEn?: string | null }
    | null
    | undefined,
  locale: Locale,
): string {
  if (!classification) return "";
  return pickLocalizedName(
    locale,
    classification.displayName,
    classification.displayNameEn,
  );
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

type DestinationFields = {
  id: number;
  name: string;
  nameEn?: string | null;
  details: string | null;
};

/**
 * Destination `details` is Arabic-only (no detailsEn column). For English
 * UI we omit it so the secondary label never appears as Arabic prose.
 */
export function localizedDestinationDetails(
  details: string | null | undefined,
  locale: Locale,
): string | null {
  if (locale === "en") return null;
  return details?.trim() ? details : null;
}

/**
 * Rewrite `destination.name` for API responses so clients receive the
 * locale-appropriate city label. Arabic-only `details` are cleared in EN.
 */
export function withLocalizedDestination<
  T extends { destination: DestinationFields | null },
>(entity: T, locale: Locale): T {
  if (!entity.destination) return entity;
  return {
    ...entity,
    destination: {
      ...entity.destination,
      name: localizedDestination(entity.destination, locale),
      details: localizedDestinationDetails(entity.destination.details, locale),
    },
  };
}

export function localizedDestinationName(
  destination:
    | { name: string; nameEn?: string | null }
    | null
    | undefined,
  locale: Locale,
): string | null {
  if (!destination) return null;
  return localizedDestination(destination, locale) || null;
}

type SizeFields = {
  displayName: string;
  displayNameEn?: string | null;
};

type StockNameFields = {
  nameAr: string;
  nameEn?: string | null;
};

type SourceLocationFields = StockNameFields & {
  yard?: StockNameFields | null;
};

function withLocalizedSizeFields<T extends SizeFields>(size: T, locale: Locale): T {
  return { ...size, displayName: localizedSize(size, locale) };
}

type ClassificationFields = {
  displayName: string;
  displayNameEn?: string | null;
};

function withLocalizedClassificationFields<T extends ClassificationFields>(
  classification: T,
  locale: Locale,
): T {
  return {
    ...classification,
    displayName: localizedClassification(classification, locale),
  };
}

function withLocalizedStockNameFields<T extends StockNameFields>(
  entity: T,
  locale: Locale,
): T {
  return { ...entity, nameAr: localizedStockName(entity, locale) };
}

/**
 * Localize nested destination + size labels on a truck operation detail/list
 * payload before sending it to the client.
 */
export function withLocalizedTruckLabels<T extends Record<string, unknown>>(
  truck: T,
  locale: Locale,
): T {
  const dest = truck.destination as DestinationFields | null | undefined;
  const requestItems = truck.requestItems as
    | Array<
        {
          size: SizeFields;
          classification?: ClassificationFields | null;
        } & Record<string, unknown>
      >
    | undefined;
  const sessions = truck.sessions as
    | Array<
        {
          size: SizeFields | null;
          classification?: ClassificationFields | null;
          sourceLocation?: SourceLocationFields | null;
        } & Record<string, unknown>
      >
    | undefined;
  const rounds = truck.rounds as
    | Array<{ size: SizeFields | null } & Record<string, unknown>>
    | undefined;

  return {
    ...truck,
    ...(dest
      ? {
          destination: {
            ...dest,
            name: localizedDestination(dest, locale),
            details: localizedDestinationDetails(dest.details, locale),
          },
        }
      : {}),
    ...(requestItems
      ? {
          requestItems: requestItems.map((item) => ({
            ...item,
            size: withLocalizedSizeFields(item.size, locale),
            ...(item.classification
              ? {
                  classification: withLocalizedClassificationFields(
                    item.classification,
                    locale,
                  ),
                }
              : {}),
          })),
        }
      : {}),
    ...(sessions
      ? {
          sessions: sessions.map((s) => {
            const sourceLocation = s.sourceLocation
              ? {
                  ...withLocalizedStockNameFields(s.sourceLocation, locale),
                  ...(s.sourceLocation.yard
                    ? {
                        yard: withLocalizedStockNameFields(
                          s.sourceLocation.yard,
                          locale,
                        ),
                      }
                    : {}),
                }
              : s.sourceLocation;
            return {
              ...s,
              size: s.size ? withLocalizedSizeFields(s.size, locale) : s.size,
              ...(s.classification
                ? {
                    classification: withLocalizedClassificationFields(
                      s.classification,
                      locale,
                    ),
                  }
                : {}),
              sourceLocation,
            };
          }),
        }
      : {}),
    ...(rounds
      ? {
          rounds: rounds.map((r) => ({
            ...r,
            size: r.size ? withLocalizedSizeFields(r.size, locale) : r.size,
          })),
        }
      : {}),
  };
}
