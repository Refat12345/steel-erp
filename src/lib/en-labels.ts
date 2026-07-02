/**
 * English label dictionary for the English-language reports (e.g. the Daily
 * Loading Summary). The database stores city names in Arabic
 * (`Destination.name`) and size names in Arabic (`SizeLookup.displayName`),
 * so this map provides their English equivalents.
 *
 * To add a translation later, just add a line here — no other code changes
 * are needed. Anything missing from the dictionary falls back gracefully
 * (cities keep their Arabic name; sizes get a best-effort transliteration).
 */

import type { SalesOrderGrade, TruckStatus } from "@prisma/client";
import type { ReportProductFilter } from "@/lib/material-kind";

const CITY_EN: Record<string, string> = {
  دمشق: "Damascus",
  "ريف دمشق": "Rural Damascus",
  حمص: "Homs",
  حماة: "Hama",
  حلب: "Aleppo",
  اللاذقية: "Lattakia",
  طرطوس: "Tartus",
  درعا: "Daraa",
  السويداء: "As-Suwayda",
  إدلب: "Idlib",
  الحسكة: "Al-Hasakah",
  "دير الزور": "Deir ez-Zor",
  الرقة: "Raqqa",
  القنيطرة: "Quneitra",
};

/** Keyed by the stable English `SizeLookup.code` (language-independent). */
const SIZE_EN_BY_CODE: Record<string, string> = {
  "6mm": "6mm",
  "8mm": "8mm",
  "10mm": "10mm",
  "12mm": "12mm",
  "14mm": "14mm",
  "16mm": "16mm",
  "18mm": "18mm",
  "20mm": "20mm",
  "22mm": "22mm",
  "25mm": "25mm",
  shortbar_1_4m: "Short bars 1–4 m",
  shortbar_4_12m: "Short bars 4–12 m",
  scrap: "Scrap",
  billet_wire_6mm: "Imported billet tying wire 6mm",
  rebar_under_70cm: "Rebar under 70 cm",
  billet_scrap_10m: "Billet scrap 10m",
  scrap_50cm_1m: "Scrap 50 cm to 1 m",
};

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function latinizeDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

/** Translate a city (destination) name to English, falling back to the original. */
export function toEnglishCity(arabicName: string | null | undefined): string {
  if (!arabicName) return "—";
  return CITY_EN[arabicName.trim()] ?? arabicName;
}

/**
 * Translate a size to English. Prefers the dictionary keyed by the size
 * `code`; otherwise transliterates the Arabic display name (Arabic-Indic
 * digits → Latin, "مم" → "mm", "م" → "m") so unknown sizes still read in
 * English.
 */
export function toEnglishSize(
  displayName: string,
  code?: string | null,
): string {
  if (code && SIZE_EN_BY_CODE[code]) return SIZE_EN_BY_CODE[code];
  const transliterated = latinizeDigits(displayName)
    .trim()
    .replace(/مم/g, "mm")
    .replace(/قصائر/g, "Short bars")
    .replace(/خردة/g, "Scrap")
    .replace(/(^|\s)م(\s|$)/g, "$1m$2");
  return transliterated || displayName;
}

/** English truck status labels — mirrors TRUCK_STATUS_LABELS in report.service.ts. */
export const TRUCK_STATUS_EN: Record<TruckStatus, string> = {
  Queued: "Queued",
  Approved: "Approved",
  FirstWeigh: "Empty weigh",
  Loading: "Loading",
  OnScale: "On scale",
  LoadingComplete: "Loading complete",
  SecondWeigh: "Loaded weigh",
  Completed: "Completed",
  Cancelled: "Cancelled",
};

/** English grade label, or "—" when no grade is set. */
export function gradeLabelEn(grade: SalesOrderGrade | null | undefined): string {
  if (grade === "FIRST") return "First grade";
  if (grade === "SECOND") return "Second grade";
  return "—";
}

/** English product filter label (rebar grade, shortbar, scrap). */
export function productFilterLabelEn(
  filter: ReportProductFilter | null | undefined,
): string {
  if (filter === "FIRST") return "First grade";
  if (filter === "SECOND") return "Second grade";
  if (filter === "SHORTBAR") return "Short bars";
  if (filter === "SCRAP") return "Scrap";
  if (filter === "BILLET_WIRE") return "Billet tying wire";
  if (filter === "REBAR_UNDER_70CM") return "Rebar under 70 cm";
  if (filter === "BILLET_SCRAP_10M") return "Billet scrap 10m";
  if (filter === "SCRAP_50CM_1M") return "Scrap 50 cm to 1 m";
  return "—";
}

/**
 * English tonnage note — mirrors TONNAGE_NOTE / buildNote in report.service.ts.
 * For cancelled trucks the raw (Arabic) cancel reason is passed through unchanged.
 */
export function tonnageNoteEn(
  status: string,
  cancelReason: string | null | undefined,
  isPartialVisit = false,
): string | null {
  const parts: string[] = [];
  if (status === "excluded_cancelled") {
    if (cancelReason?.trim()) parts.push(cancelReason.trim());
  } else if (status === "excluded_late_close") {
    parts.push("Completed after the operational day ended");
  } else if (status === "excluded_open") {
    parts.push("Not completed yet");
  }
  if (isPartialVisit) {
    parts.push("Mixed visit — filtered product portion only");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
