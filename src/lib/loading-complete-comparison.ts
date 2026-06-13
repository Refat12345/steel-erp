import { aggregateWeighSessionsBySize } from "@/lib/weigh-session-aggregate";
import { sizeCodeSupportsGrade } from "@/lib/material-kind";

const TON_EPS = 0.0005;

export interface RequestVsLoadedRow {
  sizeId: number;
  grade: "FIRST" | "SECOND" | null;
  displayName: string;
  requestedLabel: string;
  loadedLabel: string;
}

type RequestItemInput = {
  sizeId: number;
  grade?: "FIRST" | "SECOND" | null;
  bundleCount: number | null;
  requestedTons: string | number | null;
  size: { displayName: string; isBundleType: boolean; code?: string };
};

type SessionInput = {
  sizeId: number | null;
  bundleCount: number | null;
  weightTons: string | number;
  size: { displayName: string } | null;
};

function formatRequested(item: RequestItemInput): string {
  if (item.size.isBundleType) {
    return item.bundleCount != null
      ? `${item.bundleCount.toLocaleString("en-US")} ربطة`
      : "—";
  }
  if (item.requestedTons == null) return "—";
  const t =
    typeof item.requestedTons === "string"
      ? Number(item.requestedTons)
      : item.requestedTons;
  return `${t.toFixed(3)} طن`;
}

function formatLoaded(
  isBundleType: boolean,
  loaded: { totalTons: number; totalBundles: number | null } | undefined,
): string {
  if (!loaded) return "—";
  if (isBundleType) {
    return loaded.totalBundles != null
      ? `${loaded.totalBundles.toLocaleString("en-US")} ربطة`
      : "—";
  }
  return `${loaded.totalTons.toFixed(3)} طن`;
}

/**
 * Which request lines belong to the round being confirmed.
 *
 * - roundGrade FIRST/SECOND → that grade's rebar lines (+ legacy ungraded rebar);
 *   shortbar/scrap (grade-less, non-rebar) belong to their own round only.
 * - roundGrade null → shortbar/scrap lines only (non-rebar, grade-less).
 * - roundGrade undefined → whole-operation comparison (all lines).
 */
function filterRequestItemsForRound(
  requestItems: ReadonlyArray<RequestItemInput>,
  roundGrade: "FIRST" | "SECOND" | null | undefined,
): ReadonlyArray<RequestItemInput> {
  if (roundGrade === undefined) return requestItems;

  return requestItems.filter((item) => {
    const itemGrade = item.grade ?? null;
    const code = item.size.code ?? "";

    if (roundGrade === null) {
      if (itemGrade != null) return false;
      return code ? !sizeCodeSupportsGrade(code) : true;
    }

    if (itemGrade === roundGrade) return true;
    if (itemGrade === null && sizeCodeSupportsGrade(code)) return true;
    return false;
  });
}

/**
 * Read-only request vs loaded rows and mismatch warnings (never blocks
 * confirm).
 *
 * Multi-round: pass `roundGrade` and only the CURRENT round's sessions.
 * Request lines are filtered to those relevant to this round — e.g.
 * shortbar lines are not checked when confirming a FIRST rebar round.
 */
export function buildRequestVsLoadedComparison(
  requestItems: ReadonlyArray<RequestItemInput>,
  sessions: ReadonlyArray<SessionInput>,
  roundGrade?: "FIRST" | "SECOND" | null,
): { rows: RequestVsLoadedRow[]; warnings: string[] } {
  const items = filterRequestItemsForRound(requestItems, roundGrade);
  if (items.length === 0 && requestItems.length === 0) {
    return { rows: [], warnings: [] };
  }

  const bySize = aggregateWeighSessionsBySize(sessions);
  const loadedBySizeId = new Map(
    bySize
      .filter((r) => r.sizeId != null)
      .map((r) => [r.sizeId as number, r]),
  );
  const requestedSizeIds = new Set(items.map((i) => i.sizeId));
  const warnings: string[] = [];
  const rows: RequestVsLoadedRow[] = [];

  for (const item of items) {
    const loaded = loadedBySizeId.get(item.sizeId);
    const requestedLabel = formatRequested(item);
    const loadedLabel = formatLoaded(item.size.isBundleType, loaded);

    rows.push({
      sizeId: item.sizeId,
      grade: item.grade ?? null,
      displayName: item.size.displayName,
      requestedLabel,
      loadedLabel,
    });

    if (!loaded || (item.size.isBundleType ? loaded.totalBundles == null : loaded.totalTons <= 0)) {
      if (item.size.isBundleType ? item.bundleCount != null : item.requestedTons != null) {
        warnings.push(
          `لم يُسجَّل تحميل لقياس «${item.size.displayName}» (المطلوب: ${requestedLabel})`,
        );
      }
      continue;
    }

    if (item.size.isBundleType) {
      if (item.bundleCount == null || loaded.totalBundles == null) continue;
      if (loaded.totalBundles < item.bundleCount) {
        warnings.push(
          `الربطات المحمّلة أقل من المطلوب لقياس «${item.size.displayName}»: مطلوب ${requestedLabel}، محمّل ${loadedLabel}`,
        );
      } else if (loaded.totalBundles > item.bundleCount) {
        warnings.push(
          `الربطات المحمّلة أكثر من المطلوب لقياس «${item.size.displayName}»: مطلوب ${requestedLabel}، محمّل ${loadedLabel}`,
        );
      }
    } else if (item.requestedTons != null) {
      const req =
        typeof item.requestedTons === "string"
          ? Number(item.requestedTons)
          : item.requestedTons;
      const diff = loaded.totalTons - req;
      if (diff < -TON_EPS) {
        warnings.push(
          `الوزن المحمّل أقل من المطلوب لقياس «${item.size.displayName}»: مطلوب ${requestedLabel}، محمّل ${loadedLabel}`,
        );
      } else if (diff > TON_EPS) {
        warnings.push(
          `الوزن المحمّل أكثر من المطلوب لقياس «${item.size.displayName}»: مطلوب ${requestedLabel}، محمّل ${loadedLabel}`,
        );
      }
    }
  }

  for (const row of bySize) {
    if (row.sizeId != null && !requestedSizeIds.has(row.sizeId)) {
      const loadedLabel = row.totalBundles != null
        ? `${row.totalBundles.toLocaleString("en-US")} ربطة · ${row.totalTons.toFixed(3)} طن`
        : `${row.totalTons.toFixed(3)} طن`;
      warnings.push(
        `قياس «${row.displayName}» محمّل (${loadedLabel}) وغير موجود في تفاصيل الطلبية`,
      );
    }
  }

  return { rows, warnings };
}
