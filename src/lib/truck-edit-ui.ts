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

/** Mid-weighing: registration is frozen; request items stay editable until close. */
export const REQUEST_ITEMS_EDITABLE_DURING_LOADING_STATUSES = [
  "OnScale",
  "Loading",
  "LoadingComplete",
  "SecondWeigh",
] as const;

// Statuses where the truck is mid-weighing: registration/order data is frozen,
// but operational notes can still be added, edited, or cleared. Kept in one
// place so the service guard, API guard, and UI button stay in lockstep.
export const NOTES_ONLY_EDITABLE_STATUSES = [
  "OnScale",
  "Loading",
  "LoadingComplete",
  "SecondWeigh",
] as const;

export function isRequestItemsEditableDuringLoading(status: string): boolean {
  return (REQUEST_ITEMS_EDITABLE_DURING_LOADING_STATUSES as readonly string[]).includes(
    status,
  );
}

export function isRequestItemsOnlyEdit(
  status: string,
  sessionCount: number,
  canEditApproved = true,
): boolean {
  if (status === "Approved") return true;
  if (status === "FirstWeigh" && sessionCount === 0) return !canEditApproved;
  if (status === "FirstWeigh" && sessionCount > 0) return true;
  return isRequestItemsEditableDuringLoading(status);
}

export function canShowTruckEditButton(
  status: string,
  sessionCount: number,
  canEditQueued: boolean,
  canEditApproved: boolean,
  canEditRequestItems: boolean,
): boolean {
  if (status === "Queued") return canEditQueued;
  if (status === "Approved") return canEditRequestItems;
  if (status === "FirstWeigh") {
    if (sessionCount === 0) return canEditApproved || canEditRequestItems;
    return canEditRequestItems;
  }
  if (isRequestItemsEditableDuringLoading(status)) return canEditRequestItems;
  return false;
}

export function canShowTruckNotesButton(
  status: string,
  canEditApproved: boolean,
): boolean {
  return (
    canEditApproved &&
    (NOTES_ONLY_EDITABLE_STATUSES as readonly string[]).includes(status)
  );
}
