import type { SalesOrderGrade } from "@prisma/client";

export type MaterialKind =
  | "REBAR"
  | "SHORTBAR_1_4M"
  | "SHORTBAR_4_12M"
  | "SCRAP"
  | "BILLET_WIRE"
  | "REBAR_UNDER_70CM"
  | "BILLET_SCRAP_10M"
  | "SCRAP_50CM_1M";

/** Stable SizeLookup.code for the imported billet tying wire (6mm). */
export const BILLET_WIRE_SIZE_CODE = "billet_wire_6mm";

/** Stable SizeLookup.code for rebar pieces under 70 cm (sold by ton). */
export const REBAR_UNDER_70CM_SIZE_CODE = "rebar_under_70cm";

/** Stable SizeLookup.code for billet scrap 10 m (sold by ton). */
export const BILLET_SCRAP_10M_SIZE_CODE = "billet_scrap_10m";

/** Stable SizeLookup.code for scrap 50 cm to 1 m (sold by ton). */
export const SCRAP_50CM_1M_SIZE_CODE = "scrap_50cm_1m";

/** Report filter values — extends rebar grades with non-rebar product groups. */
export type ReportProductFilter =
  | SalesOrderGrade
  | "SHORTBAR"
  | "SCRAP"
  | "BILLET_WIRE"
  | "REBAR_UNDER_70CM"
  | "BILLET_SCRAP_10M"
  | "SCRAP_50CM_1M";

export const PRODUCT_FILTER_LABELS_AR: Record<ReportProductFilter, string> = {
  FIRST: "نخب أول",
  SECOND: "نخب ثاني",
  SHORTBAR: "قصائر",
  SCRAP: "خردة",
  BILLET_WIRE: "أسلاك تربيط",
  REBAR_UNDER_70CM: "مبروم أقل من 70 سم",
  BILLET_SCRAP_10M: "بيلت خردة 10m",
  SCRAP_50CM_1M: "سكراب من 50 سم إلى 1 م",
};

/** Map a SizeLookup.code to the high-level material kind. */
export function sizeCodeToKind(code: string): MaterialKind {
  if (code === "shortbar_1_4m") return "SHORTBAR_1_4M";
  if (code === "shortbar_4_12m") return "SHORTBAR_4_12M";
  if (code === "scrap") return "SCRAP";
  if (code === BILLET_WIRE_SIZE_CODE) return "BILLET_WIRE";
  if (code === REBAR_UNDER_70CM_SIZE_CODE) return "REBAR_UNDER_70CM";
  if (code === BILLET_SCRAP_10M_SIZE_CODE) return "BILLET_SCRAP_10M";
  if (code === SCRAP_50CM_1M_SIZE_CODE) return "SCRAP_50CM_1M";
  return "REBAR";
}

export function isShortbarKind(kind: MaterialKind): boolean {
  return kind === "SHORTBAR_1_4M" || kind === "SHORTBAR_4_12M";
}

/**
 * Bulk material kinds that are NOT weighed on the internal scale — only the
 * external weighbridge (tare + gross) is used. Loose bulk products skip
 * internal weigh sessions.
 */
export function isInternalWeighingExemptKind(kind: MaterialKind): boolean {
  return (
    kind === "SCRAP" ||
    kind === "BILLET_WIRE" ||
    kind === "REBAR_UNDER_70CM" ||
    kind === "BILLET_SCRAP_10M" ||
    kind === "SCRAP_50CM_1M"
  );
}

/**
 * A truck is exempt from internal weighing when EVERY distinct size on its
 * request items is a bulk-exempt kind (scrap, billet wire, …). A single
 * non-exempt size (e.g. rebar) disables the exemption because that material
 * genuinely needs internal weigh sessions.
 *
 * When more than one exempt size is on the truck (e.g. scrap in round 1 +
 * billet wire in round 2), the loader picks the material of each bridge
 * round at loading-complete time (`BridgeRound.sizeId`) so the auto-generated
 * mirror session stays unambiguously attributable in reports.
 */
export function requestSizeCodesExemptFromInternalWeighing(
  sizeCodes: ReadonlyArray<string>,
): boolean {
  const distinct = [...new Set(sizeCodes.filter(Boolean))];
  if (distinct.length === 0) return false;
  return distinct.every((code) => isInternalWeighingExemptKind(sizeCodeToKind(code)));
}

/** Product family for one bridge round — multiple sizes within the same group are OK. */
export type RoundMaterialGroup =
  | "REBAR"
  | "SHORTBAR"
  | "SCRAP"
  | "BILLET_WIRE"
  | "REBAR_UNDER_70CM"
  | "BILLET_SCRAP_10M"
  | "SCRAP_50CM_1M";

export function materialKindToRoundGroup(kind: MaterialKind): RoundMaterialGroup {
  if (kind === "REBAR") return "REBAR";
  if (isShortbarKind(kind)) return "SHORTBAR";
  if (kind === "BILLET_WIRE") return "BILLET_WIRE";
  if (kind === "REBAR_UNDER_70CM") return "REBAR_UNDER_70CM";
  if (kind === "BILLET_SCRAP_10M") return "BILLET_SCRAP_10M";
  if (kind === "SCRAP_50CM_1M") return "SCRAP_50CM_1M";
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
  if (filter === "BILLET_WIRE") return kind === "BILLET_WIRE";
  if (filter === "REBAR_UNDER_70CM") return kind === "REBAR_UNDER_70CM";
  if (filter === "BILLET_SCRAP_10M") return kind === "BILLET_SCRAP_10M";
  if (filter === "SCRAP_50CM_1M") return kind === "SCRAP_50CM_1M";
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
