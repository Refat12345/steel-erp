/** One row per size: summed tons (and bundles when all sessions report a count). */
export interface WeighSessionSizeAggregate {
  sizeId: number | null;
  displayName: string;
  totalTons: number;
  totalBundles: number | null;
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
