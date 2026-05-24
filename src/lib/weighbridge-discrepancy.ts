/**
 * Cross-verification between external weighbridge net (gross − tare) and
 * the sum of internal weigh sessions. Warning threshold is configurable via
 * WEIGHBRIDGE_DISCREPANCY_WARN_KG (default 200 kg).
 */

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const WEIGHBRIDGE_DISCREPANCY_WARN_KG = Math.max(
  0,
  envInt("WEIGHBRIDGE_DISCREPANCY_WARN_KG", 200),
);

export interface WeighbridgeDiscrepancyResult {
  bridgeNetKg: number;
  internalKg: number;
  internalTotalTons: number;
  discrepancyKg: number;
}

export function computeWeighbridgeDiscrepancy(params: {
  tareKg: number;
  grossKg: number;
  internalTotalTons: number;
}): WeighbridgeDiscrepancyResult {
  const bridgeNetKg = params.grossKg - params.tareKg;
  const internalKg = params.internalTotalTons * 1000;
  const discrepancyKg = Math.abs(bridgeNetKg - internalKg);
  return {
    bridgeNetKg,
    internalKg,
    internalTotalTons: params.internalTotalTons,
    discrepancyKg,
  };
}

export function isWeighbridgeDiscrepancyWarning(
  discrepancyKg: number,
  thresholdKg = WEIGHBRIDGE_DISCREPANCY_WARN_KG,
): boolean {
  return discrepancyKg > thresholdKg;
}

export function buildWeighbridgeDiscrepancyAuditFields(params: {
  tareKg: number;
  grossKg: number;
  internalTotalTons: number;
}) {
  const { bridgeNetKg, internalTotalTons, discrepancyKg } =
    computeWeighbridgeDiscrepancy(params);
  return {
    bridgeNetKg,
    internalTotalTons,
    discrepancyKg,
    discrepancyWarning: isWeighbridgeDiscrepancyWarning(discrepancyKg),
    discrepancyThresholdKg: WEIGHBRIDGE_DISCREPANCY_WARN_KG,
  };
}
