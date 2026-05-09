import type { SalesOrderGrade } from "@prisma/client";

export const GRADE_LABELS: Record<SalesOrderGrade, string> = {
  FIRST: "نخب أول",
  SECOND: "نخب ثاني",
};

interface TruckWithGrade {
  operationalGrade?: SalesOrderGrade | null;
  salesOrder?: { grade?: SalesOrderGrade | null } | null;
}

/**
 * Returns the effective grade for display purposes.
 *
 * Priority rule: salesOrder.grade > operationalGrade
 *
 * When a SalesOrder is linked its grade is the contract-authoritative source.
 * `operationalGrade` is a temporary operational declaration captured at
 * registration time and used only until a SalesOrder is linked.
 */
export function getDisplayGrade(truck: TruckWithGrade): SalesOrderGrade | null {
  return truck.salesOrder?.grade ?? truck.operationalGrade ?? null;
}

/** Convenience wrapper — returns the Arabic label or null when grade is absent. */
export function getDisplayGradeLabel(truck: TruckWithGrade): string | null {
  const grade = getDisplayGrade(truck);
  return grade ? GRADE_LABELS[grade] : null;
}
