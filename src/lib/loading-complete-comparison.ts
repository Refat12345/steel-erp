import { aggregateWeighSessionsBySize } from "@/lib/weigh-session-aggregate";

const TON_EPS = 0.0005;

export interface RequestVsLoadedRow {
  sizeId: number;
  displayName: string;
  requestedLabel: string;
  loadedLabel: string;
}

type RequestItemInput = {
  sizeId: number;
  bundleCount: number | null;
  requestedTons: string | number | null;
  size: { displayName: string; isBundleType: boolean };
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
      ? `${item.bundleCount.toLocaleString("ar-SY")} ربطة`
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
      ? `${loaded.totalBundles.toLocaleString("ar-SY")} ربطة`
      : "—";
  }
  return `${loaded.totalTons.toFixed(3)} طن`;
}

/** Read-only request vs loaded rows and mismatch warnings (never blocks confirm). */
export function buildRequestVsLoadedComparison(
  requestItems: ReadonlyArray<RequestItemInput>,
  sessions: ReadonlyArray<SessionInput>,
): { rows: RequestVsLoadedRow[]; warnings: string[] } {
  if (requestItems.length === 0) {
    return { rows: [], warnings: [] };
  }

  const bySize = aggregateWeighSessionsBySize(sessions);
  const loadedBySizeId = new Map(
    bySize
      .filter((r) => r.sizeId != null)
      .map((r) => [r.sizeId as number, r]),
  );
  const requestedSizeIds = new Set(requestItems.map((i) => i.sizeId));
  const warnings: string[] = [];
  const rows: RequestVsLoadedRow[] = [];

  for (const item of requestItems) {
    const loaded = loadedBySizeId.get(item.sizeId);
    const requestedLabel = formatRequested(item);
    const loadedLabel = formatLoaded(item.size.isBundleType, loaded);

    rows.push({
      sizeId: item.sizeId,
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
        ? `${row.totalBundles.toLocaleString("ar-SY")} ربطة · ${row.totalTons.toFixed(3)} طن`
        : `${row.totalTons.toFixed(3)} طن`;
      warnings.push(
        `قياس «${row.displayName}» محمّل (${loadedLabel}) وغير موجود في تفاصيل الطلبية`,
      );
    }
  }

  return { rows, warnings };
}
