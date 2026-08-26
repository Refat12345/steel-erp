/**
 * New request / weigh / stock lines stay unclassified. The clerk picks
 * B500B only when that standard applies. B400DWR is historical and is
 * not offered on new selections — even if the DB row is still active.
 */
export const DEFAULT_STEEL_CLASSIFICATION_CODE = null;

export const RETIRED_STEEL_CLASSIFICATION_CODES = ["B400DWR"] as const;

export function isOfferedSteelClassificationCode(code: string): boolean {
  return !(RETIRED_STEEL_CLASSIFICATION_CODES as readonly string[]).includes(
    code,
  );
}

export function offeredSteelClassifications<T extends { code: string }>(
  rows: ReadonlyArray<T>,
): T[] {
  return rows.filter((row) => isOfferedSteelClassificationCode(row.code));
}

/**
 * Base UI Select treats `""` as unselected and shows the placeholder.
 * Use this item value so "no classification" appears as the chosen default.
 */
export const NO_CLASSIFICATION_SELECT_VALUE = "__none__";

export function classificationSelectValue(
  id: string | null | undefined,
): string {
  return id ? id : NO_CLASSIFICATION_SELECT_VALUE;
}

export function classificationIdFromSelect(
  value: string | null | undefined,
): string {
  if (!value || value === NO_CLASSIFICATION_SELECT_VALUE) return "";
  return value;
}

type ClassificationRef = {
  id: number;
  code: string;
  grade: string;
};

export function defaultClassificationId(
  _classifications?: ReadonlyArray<ClassificationRef>,
  _grade?: string | null,
): string {
  return "";
}

/**
 * Keep the current classification only when it is still in the offered
 * catalog and matches `nextGrade`. Otherwise clear it — never invent a
 * default.
 */
export function resolveClassificationId(opts: {
  current: string;
  nextGrade: string | null | undefined;
  classifications: ReadonlyArray<ClassificationRef>;
  /** Kept for callers; defaults are no longer applied. */
  applyDefaultIfEmpty?: boolean;
}): string {
  const { current, nextGrade, classifications } = opts;
  if (!current || !nextGrade) return "";
  const c = classifications.find((x) => String(x.id) === current);
  if (c && c.grade === nextGrade) return current;
  return "";
}

type RequestLineClassKey = {
  sizeCode: string;
  grade: string;
  classificationId: string;
};

/** Unclassified plus every offered id for this grade. */
export function offeredClassificationSelectIds(
  classifications: ReadonlyArray<ClassificationRef>,
  grade: string,
): string[] {
  return [
    "",
    ...classifications
      .filter((c) => c.grade === grade)
      .map((c) => String(c.id)),
  ];
}

export function usedClassificationIdsForSizeGrade(
  lines: ReadonlyArray<RequestLineClassKey>,
  sizeCode: string,
  grade: string,
): Set<string> {
  return new Set(
    lines
      .filter((line) => line.sizeCode === sizeCode && line.grade === grade)
      .map((line) => line.classificationId),
  );
}

/**
 * A size stays in the picker when this row already has it, or when at least
 * one (size, grade, classification) slot — including "none" — is still free.
 * Otherwise 16mm FIRST unclassified hides 16mm on the next row before the
 * clerk can switch that row to B500B.
 */
export function isSizeSelectableOnRequestLine(opts: {
  sizeCode: string;
  rowSizeCode: string;
  rowGrade: string;
  otherLines: ReadonlyArray<RequestLineClassKey>;
  offeredClassificationIds: readonly string[];
}): boolean {
  if (opts.sizeCode === opts.rowSizeCode) return true;
  const used = usedClassificationIdsForSizeGrade(
    opts.otherLines,
    opts.sizeCode,
    opts.rowGrade,
  );
  return opts.offeredClassificationIds.some((id) => !used.has(id));
}

/** Keep the current class when free; otherwise first unused slot. */
export function unusedClassificationId(opts: {
  current: string;
  usedByOthers: ReadonlySet<string>;
  offeredClassificationIds: readonly string[];
}): string {
  if (
    opts.offeredClassificationIds.includes(opts.current) &&
    !opts.usedByOthers.has(opts.current)
  ) {
    return opts.current;
  }
  return opts.offeredClassificationIds.find((id) => !opts.usedByOthers.has(id)) ?? "";
}
