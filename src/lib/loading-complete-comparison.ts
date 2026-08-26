import {
  aggregateWeighSessionsBySize,
  aggregateWeighSessionsBySizeAndClassification,
} from "@/lib/weigh-session-aggregate";
import { sizeCodeSupportsGrade } from "@/lib/material-kind";

const TON_EPS = 0.0005;

export interface RequestVsLoadedRow {
  sizeId: number;
  grade: "FIRST" | "SECOND" | null;
  displayName: string;
  classificationName: string | null;
  requestedLabel: string;
  loadedLabel: string;
}

type RequestItemInput = {
  sizeId: number;
  grade?: "FIRST" | "SECOND" | null;
  classificationId?: number | null;
  /** Technical classification (B500B / B400DWR) of this line, when any. */
  classification?: { code?: string; displayName: string } | null;
  bundleCount: number | null;
  requestedTons: string | number | null;
  size: { displayName: string; isBundleType: boolean; code?: string };
};

type SessionInput = {
  sizeId: number | null;
  classificationId?: number | null;
  bundleCount: number | null;
  weightTons: string | number;
  size: { displayName: string; isBundleType?: boolean } | null;
  classification?: { displayName: string } | null;
};

export type FirstGradeMatchIssue = {
  messageKey:
    | "firstGradeRequestNotLoaded"
    | "firstGradeRequestQtyMismatch"
    | "firstGradeLoadedNotInRequest"
    | "firstGradeMissingBundleCount";
  params: {
    sizeLabel: string;
    requested?: string;
    loaded?: string;
  };
};

export type FirstGradeRemainder = {
  messageKey: "firstGradePartialRemaining";
  params: {
    sizeLabel: string;
    requested: string;
    loaded: string;
    remaining: string;
  };
};

export type FirstGradeMatchResult = {
  /** Over-load, extra size/classification, missing bundle counts. */
  blocking: FirstGradeMatchIssue[];
  /** Under-load vs the request — allowed on an intermediate round. */
  remainders: FirstGradeRemainder[];
};

function toTons(value: string | number | null): number | null {
  if (value == null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

/**
 * Requested totals for one (size, grade) group. Lines that differ only by
 * classification (16mm FIRST B500B + 16mm FIRST B400DWR) are summed, since
 * sessions are compared per size; a per-classification breakdown is appended
 * to the label when the group has more than one line.
 */
function aggregateRequestedGroup(items: ReadonlyArray<RequestItemInput>): {
  bundleCount: number | null;
  requestedTons: number | null;
  requestedLabel: string;
} {
  const isBundleType = items[0].size.isBundleType;

  const bundleCount = items.every((i) => i.bundleCount != null)
    ? items.reduce((sum, i) => sum + (i.bundleCount ?? 0), 0)
    : null;
  const tonValues = items.map((i) => toTons(i.requestedTons));
  const requestedTons = tonValues.every((v) => v != null)
    ? (tonValues as number[]).reduce((sum, v) => sum + v, 0)
    : null;

  let label: string;
  if (isBundleType) {
    label =
      bundleCount != null ? `${bundleCount.toLocaleString("en-US")} ربطة` : "—";
  } else {
    label = requestedTons != null ? `${requestedTons.toFixed(3)} طن` : "—";
  }

  if (items.length > 1) {
    const parts = items.map((i) => {
      const name = i.classification?.displayName ?? "بدون تصنيف";
      const qty = i.size.isBundleType
        ? i.bundleCount != null
          ? i.bundleCount.toLocaleString("en-US")
          : "—"
        : toTons(i.requestedTons)?.toFixed(3) ?? "—";
      return `${name}: ${qty}`;
    });
    label += ` (${parts.join("، ")})`;
  }

  return { bundleCount, requestedTons, requestedLabel: label };
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

function formatQtyLabel(isBundleType: boolean, bundles: number | null, tons: number | null): string {
  if (isBundleType) {
    return bundles != null ? `${bundles.toLocaleString("en-US")} ربطة` : "—";
  }
  return tons != null ? `${tons.toFixed(3)} طن` : "—";
}

function sizeLabelOf(
  displayName: string,
  classificationName: string | null | undefined,
): string {
  return classificationName ? `${displayName} ${classificationName}` : displayName;
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
 * First-grade loaders must match the request exactly. Pure FIRST trucks
 * (no SECOND request lines) are always enforced — picking SECOND in the
 * confirm dialog cannot bypass it. Mixed trucks are enforced only on the
 * FIRST round. No FIRST-relevant lines → nothing to enforce.
 */
export function shouldEnforceFirstGradeMatch(
  requestItems: ReadonlyArray<RequestItemInput>,
  nextGrade: "FIRST" | "SECOND" | null | undefined,
): boolean {
  const firstLines = filterRequestItemsForRound(requestItems, "FIRST");
  if (firstLines.length === 0) return false;
  const secondLines = filterRequestItemsForRound(requestItems, "SECOND");
  if (secondLines.length === 0) return true;
  return nextGrade === "FIRST";
}

/**
 * Sessions that count toward a first-grade request: every closed FIRST
 * round plus the open round being confirmed (its grade may not be stamped
 * yet). Used so 10 + 10 across two weighbridge trips can fulfill 20.
 */
export function collectFirstGradeSessions<
  T extends { bridgeRoundId?: number | null },
>(
  sessions: ReadonlyArray<T>,
  rounds: ReadonlyArray<{ id: number; grade: "FIRST" | "SECOND" | null }>,
  currentRoundId: number | null,
): T[] {
  const ids = new Set<number>();
  for (const r of rounds) {
    if (r.grade === "FIRST") ids.add(r.id);
  }
  if (currentRoundId != null) ids.add(currentRoundId);
  return sessions.filter(
    (s) => s.bridgeRoundId != null && ids.has(s.bridgeRoundId),
  );
}

/**
 * First-grade match against the (cumulative) sessions passed in.
 * Under-load is a remainder (later round / close gate). Over-load, extra
 * sizes, extra classifications, and missing bundle counts are blocking.
 */
export function evaluateFirstGradeRequestMatch(
  requestItems: ReadonlyArray<RequestItemInput>,
  sessions: ReadonlyArray<SessionInput>,
): FirstGradeMatchResult {
  const items = filterRequestItemsForRound(requestItems, "FIRST");
  if (items.length === 0) return { blocking: [], remainders: [] };

  const issues: FirstGradeMatchIssue[] = [];
  const remainders: FirstGradeRemainder[] = [];
  const loadedRows = aggregateWeighSessionsBySizeAndClassification(sessions);
  const requestedSizeIds = new Set(items.map((i) => i.sizeId));

  type ClassAcc = {
    displayName: string;
    classificationName: string | null;
    isBundleType: boolean;
    bundles: number | null;
    tons: number | null;
    missingBundles: boolean;
  };

  const requestBySize = new Map<number, Map<number | null, ClassAcc>>();
  for (const item of items) {
    let byClass = requestBySize.get(item.sizeId);
    if (!byClass) {
      byClass = new Map();
      requestBySize.set(item.sizeId, byClass);
    }
    const key = item.classificationId ?? null;
    const existing = byClass.get(key);
    const className = item.classification?.displayName ?? null;
    if (!existing) {
      byClass.set(key, {
        displayName: item.size.displayName,
        classificationName: className,
        isBundleType: item.size.isBundleType,
        bundles: item.size.isBundleType ? item.bundleCount : null,
        tons: item.size.isBundleType ? null : toTons(item.requestedTons),
        missingBundles: false,
      });
    } else {
      if (existing.isBundleType) {
        existing.bundles =
          existing.bundles != null && item.bundleCount != null
            ? existing.bundles + item.bundleCount
            : null;
      } else {
        const add = toTons(item.requestedTons);
        existing.tons =
          existing.tons != null && add != null ? existing.tons + add : null;
      }
    }
  }

  const loadedBySize = new Map<number, Map<number | null, ClassAcc>>();
  for (const row of loadedRows) {
    if (row.sizeId == null) {
      if (row.totalTons > 0 || (row.totalBundles ?? 0) > 0) {
        issues.push({
          messageKey: "firstGradeLoadedNotInRequest",
          params: {
            sizeLabel: row.displayName,
            loaded: formatQtyLabel(
              row.totalBundles != null,
              row.totalBundles,
              row.totalTons,
            ),
          },
        });
      }
      continue;
    }
    if (!requestedSizeIds.has(row.sizeId)) {
      issues.push({
        messageKey: "firstGradeLoadedNotInRequest",
        params: {
          sizeLabel: sizeLabelOf(row.displayName, row.classificationName),
          loaded: formatQtyLabel(
            row.totalBundles != null,
            row.totalBundles,
            row.totalTons,
          ),
        },
      });
      continue;
    }
    let byClass = loadedBySize.get(row.sizeId);
    if (!byClass) {
      byClass = new Map();
      loadedBySize.set(row.sizeId, byClass);
    }
    const reqSize = requestBySize.get(row.sizeId);
    const isBundleType = reqSize
      ? ([...reqSize.values()][0]?.isBundleType ?? false)
      : row.totalBundles != null;
    byClass.set(row.classificationId, {
      displayName: row.displayName,
      classificationName: row.classificationName,
      isBundleType,
      bundles: row.totalBundles,
      tons: row.totalTons,
      missingBundles: isBundleType && row.totalBundles == null,
    });
  }

  for (const [sizeId, reqByClass] of requestBySize) {
    const loadedByClass = loadedBySize.get(sizeId) ?? new Map<number | null, ClassAcc>();
    const sample = [...reqByClass.values()][0];
    if (!sample) continue;
    const isBundleType = sample.isBundleType;
    const displayName = sample.displayName;

    let leftoverBundles = 0;
    let leftoverTons = 0;

    for (const [classId, req] of reqByClass) {
      if (classId == null) continue;
      const sizeLabel = sizeLabelOf(req.displayName, req.classificationName);
      const requestedLabel = formatQtyLabel(isBundleType, req.bundles, req.tons);
      const loaded = loadedByClass.get(classId);

      if (isBundleType && req.bundles == null) continue;
      if (!isBundleType && req.tons == null) continue;

      if (isBundleType && loaded?.missingBundles) {
        issues.push({
          messageKey: "firstGradeMissingBundleCount",
          params: { sizeLabel },
        });
        continue;
      }

      if (
        !loaded ||
        (isBundleType
          ? loaded.bundles == null || loaded.bundles <= 0
          : (loaded.tons ?? 0) <= 0)
      ) {
        remainders.push({
          messageKey: "firstGradePartialRemaining",
          params: {
            sizeLabel,
            requested: requestedLabel,
            loaded: formatQtyLabel(isBundleType, isBundleType ? 0 : null, isBundleType ? null : 0),
            remaining: requestedLabel,
          },
        });
        continue;
      }

      if (isBundleType) {
        const loadedBundles = loaded.bundles ?? 0;
        const reqBundles = req.bundles ?? 0;
        if (loadedBundles < reqBundles) {
          remainders.push({
            messageKey: "firstGradePartialRemaining",
            params: {
              sizeLabel,
              requested: requestedLabel,
              loaded: formatQtyLabel(true, loadedBundles, null),
              remaining: formatQtyLabel(true, reqBundles - loadedBundles, null),
            },
          });
        } else {
          leftoverBundles += loadedBundles - reqBundles;
        }
      } else {
        const loadedTons = loaded.tons ?? 0;
        const reqTons = req.tons ?? 0;
        if (loadedTons + TON_EPS < reqTons) {
          remainders.push({
            messageKey: "firstGradePartialRemaining",
            params: {
              sizeLabel,
              requested: requestedLabel,
              loaded: formatQtyLabel(false, null, loadedTons),
              remaining: formatQtyLabel(false, null, reqTons - loadedTons),
            },
          });
        } else {
          leftoverTons += Math.max(0, loadedTons - reqTons);
        }
      }
    }

    for (const [classId, loaded] of loadedByClass) {
      if (classId == null) continue;
      if (reqByClass.has(classId)) continue;
      if (isBundleType && loaded.missingBundles) {
        issues.push({
          messageKey: "firstGradeMissingBundleCount",
          params: {
            sizeLabel: sizeLabelOf(loaded.displayName, loaded.classificationName),
          },
        });
        continue;
      }
      if (isBundleType) leftoverBundles += loaded.bundles ?? 0;
      else leftoverTons += loaded.tons ?? 0;
    }

    const loadedUnclass = loadedByClass.get(null);
    if (loadedUnclass) {
      if (isBundleType && loadedUnclass.missingBundles) {
        issues.push({
          messageKey: "firstGradeMissingBundleCount",
          params: { sizeLabel: displayName },
        });
      } else if (isBundleType) {
        leftoverBundles += loadedUnclass.bundles ?? 0;
      } else {
        leftoverTons += loadedUnclass.tons ?? 0;
      }
    }

    const reqUnclass = reqByClass.get(null);
    const unclassRequested = isBundleType
      ? (reqUnclass?.bundles ?? 0)
      : (reqUnclass?.tons ?? 0);
    const leftover = isBundleType ? leftoverBundles : leftoverTons;
    const hasUnclassQty =
      reqUnclass != null &&
      (isBundleType ? reqUnclass.bundles != null : reqUnclass.tons != null) &&
      unclassRequested > (isBundleType ? 0 : TON_EPS);

    if (!hasUnclassQty) {
      if (isBundleType ? leftover > 0 : leftover > TON_EPS) {
        const extra = [...loadedByClass.entries()].find(([id, row]) => {
          if (id == null) return (isBundleType ? (row.bundles ?? 0) : (row.tons ?? 0)) > 0;
          if (!reqByClass.has(id)) {
            return (isBundleType ? (row.bundles ?? 0) : (row.tons ?? 0)) > 0;
          }
          const req = reqByClass.get(id)!;
          return isBundleType
            ? (row.bundles ?? 0) > (req.bundles ?? 0)
            : (row.tons ?? 0) - (req.tons ?? 0) > TON_EPS;
        });
        issues.push({
          messageKey: "firstGradeLoadedNotInRequest",
          params: {
            sizeLabel: extra
              ? sizeLabelOf(extra[1].displayName, extra[1].classificationName)
              : displayName,
            loaded: formatQtyLabel(
              isBundleType,
              isBundleType ? leftover : null,
              isBundleType ? null : leftover,
            ),
          },
        });
      }
      continue;
    }

    const leftoverMatches = isBundleType
      ? leftover === unclassRequested
      : Math.abs(leftover - unclassRequested) <= TON_EPS;
    if (leftoverMatches) continue;

    if (leftover <= (isBundleType ? 0 : TON_EPS)) {
      const requestedLabel = formatQtyLabel(
        isBundleType,
        isBundleType ? unclassRequested : null,
        isBundleType ? null : unclassRequested,
      );
      remainders.push({
        messageKey: "firstGradePartialRemaining",
        params: {
          sizeLabel: displayName,
          requested: requestedLabel,
          loaded: formatQtyLabel(isBundleType, isBundleType ? 0 : null, isBundleType ? null : 0),
          remaining: requestedLabel,
        },
      });
    } else if (leftover < unclassRequested - (isBundleType ? 0 : TON_EPS)) {
      remainders.push({
        messageKey: "firstGradePartialRemaining",
        params: {
          sizeLabel: displayName,
          requested: formatQtyLabel(
            isBundleType,
            isBundleType ? unclassRequested : null,
            isBundleType ? null : unclassRequested,
          ),
          loaded: formatQtyLabel(
            isBundleType,
            isBundleType ? leftover : null,
            isBundleType ? null : leftover,
          ),
          remaining: formatQtyLabel(
            isBundleType,
            isBundleType ? unclassRequested - leftover : null,
            isBundleType ? null : unclassRequested - leftover,
          ),
        },
      });
    } else {
      issues.push({
        messageKey: "firstGradeRequestQtyMismatch",
        params: {
          sizeLabel: displayName,
          requested: formatQtyLabel(
            isBundleType,
            isBundleType ? unclassRequested : null,
            isBundleType ? null : unclassRequested,
          ),
          loaded: formatQtyLabel(
            isBundleType,
            isBundleType ? leftover : null,
            isBundleType ? null : leftover,
          ),
        },
      });
    }
  }

  return { blocking: issues, remainders };
}

/** Blocking first-grade issues only (over-load / extra size / missing counts). */
export function findFirstGradeRequestMismatches(
  requestItems: ReadonlyArray<RequestItemInput>,
  sessions: ReadonlyArray<SessionInput>,
): FirstGradeMatchIssue[] {
  return evaluateFirstGradeRequestMatch(requestItems, sessions).blocking;
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

  // One comparison row per (size, grade). Lines that differ only by
  // classification are merged — loading is compared at the size level, since
  // one weigh batch of 16mm covers both B500B and B400DWR request lines.
  const groupOrder: string[] = [];
  const groups = new Map<string, RequestItemInput[]>();
  for (const groupedItem of items) {
    const key = `${groupedItem.sizeId}:${groupedItem.grade ?? ""}`;
    const arr = groups.get(key);
    if (arr) arr.push(groupedItem);
    else {
      groups.set(key, [groupedItem]);
      groupOrder.push(key);
    }
  }

  for (const key of groupOrder) {
    const groupItems = groups.get(key)!;
    const item = groupItems[0];
    const loaded = loadedBySizeId.get(item.sizeId);
    const {
      bundleCount: requestedBundleCount,
      requestedTons: requestedTonsSum,
      requestedLabel,
    } = aggregateRequestedGroup(groupItems);
    const loadedLabel = formatLoaded(item.size.isBundleType, loaded);

    const uniqueClassNames = [
      ...new Set(
        groupItems
          .map((i) => i.classification?.displayName ?? null)
          .filter((n): n is string => n != null && n.length > 0),
      ),
    ];
    rows.push({
      sizeId: item.sizeId,
      grade: item.grade ?? null,
      displayName: item.size.displayName,
      classificationName: uniqueClassNames.length === 1 ? uniqueClassNames[0] : null,
      requestedLabel,
      loadedLabel,
    });

    if (!loaded || (item.size.isBundleType ? loaded.totalBundles == null : loaded.totalTons <= 0)) {
      if (item.size.isBundleType ? requestedBundleCount != null : requestedTonsSum != null) {
        warnings.push(
          `لم يُسجَّل تحميل لقياس «${item.size.displayName}» (المطلوب: ${requestedLabel})`,
        );
      }
      continue;
    }

    if (item.size.isBundleType) {
      if (requestedBundleCount == null || loaded.totalBundles == null) continue;
      if (loaded.totalBundles < requestedBundleCount) {
        warnings.push(
          `الربطات المحمّلة أقل من المطلوب لقياس «${item.size.displayName}»: مطلوب ${requestedLabel}، محمّل ${loadedLabel}`,
        );
      } else if (loaded.totalBundles > requestedBundleCount) {
        warnings.push(
          `الربطات المحمّلة أكثر من المطلوب لقياس «${item.size.displayName}»: مطلوب ${requestedLabel}، محمّل ${loadedLabel}`,
        );
      }
    } else if (requestedTonsSum != null) {
      const diff = loaded.totalTons - requestedTonsSum;
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
