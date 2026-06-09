/** Printable area inside A4 portrait with 6mm margins on each side. */
export const A4_PRINTABLE_WIDTH_MM = 198;
export const A4_PRINTABLE_HEIGHT_MM = 285;

/** Printable area inside A4 landscape with 10mm margins on each side. */
export const A4_LANDSCAPE_PRINTABLE_WIDTH_MM = 277;
export const A4_LANDSCAPE_PRINTABLE_HEIGHT_MM = 190;

/** Screen measurement tends to underestimate print layout height. */
export const SCALE_CARD_PRINT_HEIGHT_FUDGE = 1.12;

const MM_PER_INCH = 25.4;
const CSS_PIXELS_PER_INCH = 96;

export function mmToCssPx(mm: number): number {
  return (mm * CSS_PIXELS_PER_INCH) / MM_PER_INCH;
}

/**
 * Scale factor (≤ 1) to fit content inside one A4 printable area.
 */
export function computeA4PrintFitScale(
  contentWidthPx: number,
  contentHeightPx: number,
): number {
  if (contentWidthPx <= 0 || contentHeightPx <= 0) return 1;

  const maxW = mmToCssPx(A4_PRINTABLE_WIDTH_MM);
  const maxH = mmToCssPx(A4_PRINTABLE_HEIGHT_MM);
  return Math.min(1, maxW / contentWidthPx, maxH / contentHeightPx);
}

/**
 * Scale factor (≤ 1) to fit content inside one A4 landscape printable area.
 * Used by wide cross-tab reports (e.g. the daily loading summary).
 */
export function computeA4LandscapePrintFitScale(
  contentWidthPx: number,
  contentHeightPx: number,
): number {
  if (contentWidthPx <= 0 || contentHeightPx <= 0) return 1;

  const maxW = mmToCssPx(A4_LANDSCAPE_PRINTABLE_WIDTH_MM);
  const maxH = mmToCssPx(A4_LANDSCAPE_PRINTABLE_HEIGHT_MM);
  return Math.min(1, maxW / contentWidthPx, maxH / contentHeightPx);
}

/** @deprecated Use computeA4PrintFitScale */
export const computeInternalPrintFitScale = computeA4PrintFitScale;

/** @deprecated Use SCALE_CARD_PRINT_HEIGHT_FUDGE */
export const INTERNAL_PRINT_HEIGHT_FUDGE = SCALE_CARD_PRINT_HEIGHT_FUDGE;
