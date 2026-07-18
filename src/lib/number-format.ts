/**
 * Unified number formatting — the numeric counterpart of date-format.ts.
 *
 * All quantities (weights, money, counts) render with Latin digits and
 * en-US grouping in BOTH UI languages: operational documents (scale cards,
 * reports, invoices) must read identically regardless of the viewer's
 * locale, and `.financial-value` / `.weight-value` already force LTR.
 *
 * Replaces the scattered `toLocaleString("ar-EG" | "ar-SA" | "en-US")`
 * calls — migrate call sites to these helpers as each module is touched
 * (bilingual i18n plan, phases 3/6).
 */

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const decimalFormatters = new Map<number, Intl.NumberFormat>();

function decimalFormatter(fractionDigits: number): Intl.NumberFormat {
  let formatter = decimalFormatters.get(fractionDigits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    decimalFormatters.set(fractionDigits, formatter);
  }
  return formatter;
}

type NumericInput = number | string;

function toNumber(value: NumericInput): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Whole number with thousands separators: 12345 → "12,345". */
export function formatInteger(value: NumericInput): string {
  const n = toNumber(value);
  return n === null ? "—" : integerFormatter.format(n);
}

/** Fixed decimals with thousands separators: (1234.5, 2) → "1,234.50". */
export function formatDecimal(value: NumericInput, fractionDigits = 2): string {
  const n = toNumber(value);
  return n === null ? "—" : decimalFormatter(fractionDigits).format(n);
}

/** Financial amount — always 2 decimals: "1,234.50". */
export function formatAmount(value: NumericInput): string {
  return formatDecimal(value, 2);
}

/** Weight in kilograms, whole numbers: "12,345". */
export function formatKg(value: NumericInput): string {
  return formatInteger(value);
}
