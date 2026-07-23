/**
 * Display helpers for the weigh-session stock source shown on the scale
 * sessions table (yard location vs direct-from-production).
 */

export type WeighSessionSourceInput = {
  fromProduction: boolean;
  sourceLocation: {
    nameAr: string;
    yard?: { nameAr: string } | null;
  } | null;
};

export function formatSessionSourceLabel(
  session: WeighSessionSourceInput,
  labels: { fromProduction: string; emDash: string },
): string {
  if (session.fromProduction) return labels.fromProduction;
  const loc = session.sourceLocation;
  if (!loc) return labels.emDash;
  const yardName = loc.yard?.nameAr?.trim();
  if (yardName) return `${yardName} — ${loc.nameAr}`;
  return loc.nameAr;
}
