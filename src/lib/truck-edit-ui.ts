import type { SalesOrderGrade } from "@prisma/client";

export function effectiveOperationalGrade(
  isRebarLoad: boolean,
  grade: SalesOrderGrade | "",
): SalesOrderGrade | null {
  return isRebarLoad && grade ? grade : null;
}

/** Include operationalGrade in PATCH only when load type / grade actually changed. */
export function operationalGradeIfChanged(
  original: SalesOrderGrade | null,
  isRebarLoad: boolean,
  grade: SalesOrderGrade | "",
): { operationalGrade?: SalesOrderGrade | null } {
  const next = effectiveOperationalGrade(isRebarLoad, grade);
  if (next === original) return {};
  return { operationalGrade: next };
}

export function notesForPatch(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

export function canShowTruckEditButton(
  status: string,
  sessionCount: number,
  canEditQueued: boolean,
  canEditApproved: boolean,
): boolean {
  if (status === "Queued") return canEditQueued;
  if (status === "Approved") return canEditApproved;
  if (status === "FirstWeigh") {
    return canEditApproved && sessionCount === 0;
  }
  return false;
}
