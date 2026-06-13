import type { SalesOrderGrade } from "@prisma/client";

import {
  type ReportProductFilter,
  inferRoundMaterialKind,
  isGradeProductFilter,
  materialKindMatchesProductFilter,
  sessionMatchesProductFilter,
  type SessionWithSizeCode,
} from "@/lib/material-kind";
import {
  type BridgeRoundGradeSnapshot,
  type ReportSessionSnapshot,
  type TruckGradeFilterInput,
  computeRoundNetTons,
  getDisplayGrade,
} from "@/lib/truck-grade";

export interface ReportSessionWithSize extends ReportSessionSnapshot, SessionWithSizeCode {}

export interface ProductFilteredReportSlice {
  included: boolean;
  bridgeTons: number | null;
  internalTons: number | null;
  sessions: ReadonlyArray<ReportSessionSnapshot>;
  matchingRoundIds: ReadonlyArray<number> | null;
  isPartialVisit: boolean;
}

function getClosedRounds(truck: TruckGradeFilterInput): BridgeRoundGradeSnapshot[] {
  return (truck.rounds ?? []).filter((r) => r.endWeightKg != null);
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

function roundMatchesProductFilter(
  round: BridgeRoundGradeSnapshot,
  filter: ReportProductFilter,
  sessions: ReadonlyArray<ReportSessionWithSize>,
): boolean {
  if (isGradeProductFilter(filter)) {
    return round.grade === filter;
  }
  if (round.grade != null) return false;
  if (round.id == null) return false;
  const kind = inferRoundMaterialKind(round.id, sessions);
  return materialKindMatchesProductFilter(kind, filter);
}

function matchingClosedRounds(
  truck: TruckGradeFilterInput,
  filter: ReportProductFilter,
  sessions: ReadonlyArray<ReportSessionWithSize>,
): BridgeRoundGradeSnapshot[] {
  return getClosedRounds(truck).filter((r) =>
    roundMatchesProductFilter(r, filter, sessions),
  );
}

function legacyIncluded(
  truck: TruckGradeFilterInput,
  filter: ReportProductFilter,
  sessions: ReadonlyArray<ReportSessionWithSize>,
): boolean {
  if (isGradeProductFilter(filter)) {
    return getDisplayGrade(truck) === filter;
  }
  return sessions.some((s) => sessionMatchesProductFilter(s, filter));
}

function legacySlice(
  truck: TruckGradeFilterInput,
  filter: ReportProductFilter,
  fullBridgeTons: number | null,
  allSessions: ReadonlyArray<ReportSessionWithSize>,
): ProductFilteredReportSlice {
  if (isGradeProductFilter(filter)) {
    if (getDisplayGrade(truck) !== filter) {
      return {
        included: false,
        bridgeTons: null,
        internalTons: null,
        sessions: [],
        matchingRoundIds: [],
        isPartialVisit: false,
      };
    }

    const totalInternal = sumInternalTons(allSessions);
    return {
      included: true,
      bridgeTons: fullBridgeTons,
      internalTons: totalInternal,
      sessions: allSessions,
      matchingRoundIds: null,
      isPartialVisit: false,
    };
  }

  const matchingSessions = allSessions.filter((s) =>
    sessionMatchesProductFilter(s, filter),
  );
  if (!legacyIncluded(truck, filter, allSessions)) {
    return {
      included: false,
      bridgeTons: null,
      internalTons: null,
      sessions: [],
      matchingRoundIds: [],
      isPartialVisit: false,
    };
  }

  const totalInternal = sumInternalTons(allSessions);
  const matchingInternal = sumInternalTons(matchingSessions);
  const isPartialVisit =
    matchingSessions.length > 0 && matchingSessions.length < allSessions.length;

  let bridgeTons = fullBridgeTons;
  if (
    isPartialVisit &&
    fullBridgeTons != null &&
    totalInternal != null &&
    totalInternal > 0 &&
    matchingInternal != null
  ) {
    bridgeTons =
      Math.round(fullBridgeTons * (matchingInternal / totalInternal) * 1000) / 1000;
  }

  return {
    included: true,
    bridgeTons,
    internalTons: matchingInternal,
    sessions: matchingSessions,
    matchingRoundIds: null,
    isPartialVisit,
  };
}

/**
 * Slices a truck visit for an optional product filter (rebar grade, shortbar,
 * scrap, or null = full visit).
 */
export function sliceReportByProductFilter(
  truck: TruckGradeFilterInput,
  productFilter: ReportProductFilter | null,
  fullBridgeTons: number | null,
  allSessions: ReadonlyArray<ReportSessionWithSize>,
): ProductFilteredReportSlice {
  if (productFilter == null) {
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
    return legacySlice(truck, productFilter, fullBridgeTons, allSessions);
  }

  const matching = matchingClosedRounds(truck, productFilter, allSessions);
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

  const isPartialVisit = closedRounds.length > matching.length;

  return {
    included: true,
    bridgeTons,
    internalTons: sumInternalTons(sessions),
    sessions,
    matchingRoundIds,
    isPartialVisit,
  };
}

/** @deprecated Use sliceReportByProductFilter */
export function sliceReportByGradeFilter(
  truck: TruckGradeFilterInput,
  gradeFilter: SalesOrderGrade | null,
  fullBridgeTons: number | null,
  allSessions: ReadonlyArray<ReportSessionSnapshot>,
): ProductFilteredReportSlice {
  return sliceReportByProductFilter(
    truck,
    gradeFilter,
    fullBridgeTons,
    allSessions,
  );
}
