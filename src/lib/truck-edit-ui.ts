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

// Statuses where the truck is mid-weighing: registration/order data is frozen,
// but operational notes can still be added, edited, or cleared. Kept in one
// place so the service guard, API guard, and UI button stay in lockstep.
export const NOTES_ONLY_EDITABLE_STATUSES = [
  "OnScale",
  "LoadingComplete",
  "SecondWeigh",
] as const;

export function canShowTruckNotesButton(
  status: string,
  canEditApproved: boolean,
): boolean {
  return (
    canEditApproved &&
    (NOTES_ONLY_EDITABLE_STATUSES as readonly string[]).includes(status)
  );
}
