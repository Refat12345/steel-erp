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

export interface BridgeRoundGradeSnapshot {
  id?: number;
  grade: SalesOrderGrade | null;
  startWeightKg?: unknown;
  endWeightKg: unknown | null;
}

export interface TruckGradeFilterInput extends TruckWithGrade {
  rounds?: ReadonlyArray<BridgeRoundGradeSnapshot>;
}

export interface ReportSessionSnapshot {
  bridgeRoundId?: number | null;
  weightTons: unknown;
  bundleCount?: number | null;
  sizeId?: number | null;
}

export interface GradeFilteredReportSlice {
  included: boolean;
  bridgeTons: number | null;
  internalTons: number | null;
  sessions: ReadonlyArray<ReportSessionSnapshot>;
  /** Closed round ids matching the filter; null = all sessions apply. */
  matchingRoundIds: ReadonlyArray<number> | null;
  /** True when the visit has closed rounds outside the active grade filter. */
  isPartialVisit: boolean;
}

function getClosedRounds(truck: TruckGradeFilterInput): BridgeRoundGradeSnapshot[] {
  return (truck.rounds ?? []).filter((r) => r.endWeightKg != null);
}

/** Bridge net tons for one closed round (end − start). */
export function computeRoundNetTons(round: BridgeRoundGradeSnapshot): number | null {
  if (round.endWeightKg == null || round.startWeightKg == null) return null;
  const netKg = Number(round.endWeightKg) - Number(round.startWeightKg);
  if (!Number.isFinite(netKg)) return null;
  return Math.round((netKg / 1000) * 1000) / 1000;
}

function sumInternalTons(sessions: ReadonlyArray<ReportSessionSnapshot>): number | null {
  if (sessions.length === 0) return null;
  let total = 0;
  for (const s of sessions) {
    const w = Number(s.weightTons);
    if (Number.isFinite(w)) total += w;
  }
  return Math.round(total * 1000) / 1000;
}

function matchingClosedRounds(
  truck: TruckGradeFilterInput,
  grade: SalesOrderGrade,
): BridgeRoundGradeSnapshot[] {
  return getClosedRounds(truck).filter((r) => r.grade === grade);
}

/**
 * Whether a truck should appear in a single-grade report filter.
 *
 * With bridge rounds: at least one closed round must match G.
 * Legacy trucks (no rounds): operation-level grade must equal G.
 */
export function truckIncludedInGradeFilter(
  truck: TruckGradeFilterInput,
  grade: SalesOrderGrade,
): boolean {
  const closed = getClosedRounds(truck);
  if (closed.length > 0) {
    return matchingClosedRounds(truck, grade).length > 0;
  }
  return getDisplayGrade(truck) === grade;
}

/** @deprecated Use truckIncludedInGradeFilter + sliceReportByGradeFilter. */
export function truckMatchesGradeFilter(
  truck: TruckGradeFilterInput,
  grade: SalesOrderGrade,
): boolean {
  return truckIncludedInGradeFilter(truck, grade);
}

/**
 * Slices a truck's report tonnage and sessions for an optional grade filter.
 *
 * - `gradeFilter = null` («all grades»): full visit, one row per truck.
 * - `gradeFilter = G`: bridge/internal tons and sessions only from closed
 *   rounds labelled G; `isPartialVisit` when other closed rounds exist.
 */
export function sliceReportByGradeFilter(
  truck: TruckGradeFilterInput,
  gradeFilter: SalesOrderGrade | null,
  fullBridgeTons: number | null,
  allSessions: ReadonlyArray<ReportSessionSnapshot>,
): GradeFilteredReportSlice {
  if (gradeFilter == null) {
    return {
      included: true,
      bridgeTons: fullBridgeTons,
      internalTons: sumInternalTons(allSessions),
      sessions: allSessions,
      matchingRoundIds: null,
      isPartialVisit: false,
    };
  }

  const closedRounds = getClosedRounds(truck);

  if (closedRounds.length === 0) {
    const included = getDisplayGrade(truck) === gradeFilter;
    return {
      included,
      bridgeTons: included ? fullBridgeTons : null,
      internalTons: included ? sumInternalTons(allSessions) : null,
      sessions: included ? allSessions : [],
      matchingRoundIds: null,
      isPartialVisit: false,
    };
  }

  const matching = matchingClosedRounds(truck, gradeFilter);
  if (matching.length === 0) {
    return {
      included: false,
      bridgeTons: null,
      internalTons: null,
      sessions: [],
      matchingRoundIds: [],
      isPartialVisit: false,
    };
  }

  let bridgeTons = 0;
  for (const round of matching) {
    const net = computeRoundNetTons(round);
    if (net != null) bridgeTons += net;
  }
  bridgeTons = Math.round(bridgeTons * 1000) / 1000;

  const matchingRoundIds = matching
    .map((r) => r.id)
    .filter((id): id is number => id != null);
  const matchingRoundIdSet = new Set(matchingRoundIds);
  const sessions =
    matchingRoundIds.length > 0
      ? allSessions.filter(
          (s) => s.bridgeRoundId != null && matchingRoundIdSet.has(s.bridgeRoundId),
        )
      : allSessions;

  const isPartialVisit = closedRounds.some((r) => r.grade !== gradeFilter);

  return {
    included: true,
    bridgeTons,
    internalTons: sumInternalTons(sessions),
    sessions,
    matchingRoundIds,
    isPartialVisit,
  };
}
