import type { SalesOrderGrade } from "@prisma/client";

export type MaterialKind = "REBAR" | "SHORTBAR_1_4M" | "SHORTBAR_4_12M" | "SCRAP";

/** Report filter values — extends rebar grades with non-rebar product groups. */
export type ReportProductFilter = SalesOrderGrade | "SHORTBAR" | "SCRAP";

export const PRODUCT_FILTER_LABELS_AR: Record<ReportProductFilter, string> = {
  FIRST: "نخب أول",
  SECOND: "نخب ثاني",
  SHORTBAR: "قصائر",
  SCRAP: "خردة",
};

/** Map a SizeLookup.code to the high-level material kind. */
export function sizeCodeToKind(code: string): MaterialKind {
  if (code === "shortbar_1_4m") return "SHORTBAR_1_4M";
  if (code === "shortbar_4_12m") return "SHORTBAR_4_12M";
  if (code === "scrap") return "SCRAP";
  return "REBAR";
}

export function isShortbarKind(kind: MaterialKind): boolean {
  return kind === "SHORTBAR_1_4M" || kind === "SHORTBAR_4_12M";
}

/** Product family for one bridge round — multiple sizes within the same group are OK. */
export type RoundMaterialGroup = "REBAR" | "SHORTBAR" | "SCRAP";

export function materialKindToRoundGroup(kind: MaterialKind): RoundMaterialGroup {
  if (kind === "REBAR") return "REBAR";
  if (isShortbarKind(kind)) return "SHORTBAR";
  return "SCRAP";
}

export function sizeCodeToRoundGroup(code: string): RoundMaterialGroup {
  return materialKindToRoundGroup(sizeCodeToKind(code));
}

/**
 * Soft warning when mixing product families in one bridge round (e.g. rebar +
 * shortbar). Multiple rebar sizes (8mm + 12mm) or multiple shortbar codes in
 * the same round do not trigger this.
 */
export function shouldWarnBridgeRoundProductMix(
  existingSizeCodes: ReadonlyArray<string>,
  newSizeCode: string,
): boolean {
  if (existingSizeCodes.length === 0 || !newSizeCode) return false;
  const newGroup = sizeCodeToRoundGroup(newSizeCode);
  return existingSizeCodes.some((code) => sizeCodeToRoundGroup(code) !== newGroup);
}

/** Rebar sizes may carry FIRST/SECOND; shortbar and scrap must not. */
export function sizeCodeSupportsGrade(code: string): boolean {
  if (!code) return true;
  return sizeCodeToKind(code) === "REBAR";
}

export function isGradeProductFilter(
  filter: ReportProductFilter,
): filter is SalesOrderGrade {
  return filter === "FIRST" || filter === "SECOND";
}

export function materialKindMatchesProductFilter(
  kind: MaterialKind | null,
  filter: ReportProductFilter,
): boolean {
  if (isGradeProductFilter(filter)) return false;
  if (filter === "SHORTBAR") return kind != null && isShortbarKind(kind);
  if (filter === "SCRAP") return kind === "SCRAP";
  return false;
}

export interface SessionWithSizeCode {
  bridgeRoundId?: number | null;
  weightTons: unknown;
  size?: { code: string } | null;
}

/**
 * Infer the dominant material kind for a bridge round from its internal
 * weigh sessions (approach A — no DB schema change).
 */
export function inferRoundMaterialKind(
  roundId: number,
  sessions: ReadonlyArray<SessionWithSizeCode>,
): MaterialKind | null {
  const roundSessions = sessions.filter((s) => s.bridgeRoundId === roundId);
  if (roundSessions.length === 0) return null;

  const tonsByKind = new Map<MaterialKind, number>();
  for (const session of roundSessions) {
    const code = session.size?.code;
    if (!code) continue;
    const kind = sizeCodeToKind(code);
    const tons = Number(session.weightTons);
    if (!Number.isFinite(tons)) continue;
    tonsByKind.set(kind, (tonsByKind.get(kind) ?? 0) + tons);
  }

  let best: MaterialKind | null = null;
  let bestTons = 0;
  for (const [kind, tons] of tonsByKind) {
    if (tons > bestTons) {
      best = kind;
      bestTons = tons;
    }
  }
  return best;
}

export function sessionMatchesProductFilter(
  session: SessionWithSizeCode,
  filter: ReportProductFilter,
): boolean {
  const code = session.size?.code;
  if (!code) return false;
  const kind = sizeCodeToKind(code);
  if (isGradeProductFilter(filter)) return kind === "REBAR";
  return materialKindMatchesProductFilter(kind, filter);
}
