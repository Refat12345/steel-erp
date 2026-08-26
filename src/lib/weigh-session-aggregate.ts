/** One row per size: summed tons (and bundles when all sessions report a count). */
export interface WeighSessionSizeAggregate {
  sizeId: number | null;
  displayName: string;
  totalTons: number;
  totalBundles: number | null;
}

/**
 * One row per (size, classification): same sums, but batches of e.g. 16mm
 * B500B and 16mm B400DWR stay separate. `classificationName` is null for
 * unclassified batches.
 */
export interface WeighSessionSizeClassificationAggregate
  extends WeighSessionSizeAggregate {
  classificationId: number | null;
  classificationName: string | null;
}

export function aggregateWeighSessionsBySizeAndClassification(
  sessions: ReadonlyArray<{
    sizeId: number | null;
    classificationId?: number | null;
    bundleCount: number | null;
    weightTons: string | number;
    size: { displayName: string } | null;
    classification?: { displayName: string } | null;
  }>,
): WeighSessionSizeClassificationAggregate[] {
  type Acc = {
    sizeId: number | null;
    classificationId: number | null;
    displayName: string;
    classificationName: string | null;
    totalTons: number;
    bundleSum: number;
    anyMissingBundle: boolean;
  };

  const order: string[] = [];
  const map = new Map<string, Acc>();

  for (const s of sessions) {
    const classificationId = s.classificationId ?? null;
    const key = `${s.sizeId != null ? `id:${s.sizeId}` : "none"}|${
      classificationId != null ? `c:${classificationId}` : "none"
    }`;
    const w =
      typeof s.weightTons === "string" ? Number(s.weightTons) : s.weightTons;

    let acc = map.get(key);
    if (!acc) {
      acc = {
        sizeId: s.sizeId,
        classificationId,
        displayName: s.size?.displayName ?? "بدون قياس",
        classificationName: s.classification?.displayName ?? null,
        totalTons: 0,
        bundleSum: 0,
        anyMissingBundle: false,
      };
      map.set(key, acc);
      order.push(key);
    }
    acc.totalTons += Number.isFinite(w) ? w : 0;
    if (s.bundleCount == null) acc.anyMissingBundle = true;
    else acc.bundleSum += s.bundleCount;
  }

  return order.map((k) => {
    const a = map.get(k)!;
    return {
      sizeId: a.sizeId,
      classificationId: a.classificationId,
      displayName: a.displayName,
      classificationName: a.classificationName,
      totalTons: a.totalTons,
      totalBundles: a.anyMissingBundle ? null : a.bundleSum,
    };
  });
}

export function aggregateWeighSessionsBySize(
  sessions: ReadonlyArray<{
    sizeId: number | null;
    bundleCount: number | null;
    weightTons: string | number;
    size: { displayName: string } | null;
  }>,
): WeighSessionSizeAggregate[] {
  type Acc = {
    sizeId: number | null;
    displayName: string;
    totalTons: number;
    bundleSum: number;
    anyMissingBundle: boolean;
  };

  const order: string[] = [];
  const map = new Map<string, Acc>();

  for (const s of sessions) {
    const key = s.sizeId != null ? `id:${s.sizeId}` : "none";
    const label = s.size?.displayName ?? "بدون قياس";
    const w =
      typeof s.weightTons === "string" ? Number(s.weightTons) : s.weightTons;
    const bc = s.bundleCount;

    let acc = map.get(key);
    if (!acc) {
      acc = {
        sizeId: s.sizeId,
        displayName: label,
        totalTons: 0,
        bundleSum: 0,
        anyMissingBundle: false,
      };
      map.set(key, acc);
      order.push(key);
    }
    acc.totalTons += Number.isFinite(w) ? w : 0;
    if (bc == null) acc.anyMissingBundle = true;
    else acc.bundleSum += bc;
  }

  return order.map((k) => {
    const a = map.get(k)!;
    return {
      sizeId: a.sizeId,
      displayName: a.displayName,
      totalTons: a.totalTons,
      totalBundles: a.anyMissingBundle ? null : a.bundleSum,
    };
  });
}
