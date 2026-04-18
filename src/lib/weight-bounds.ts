/**
 * Weight reasonableness bounds for tare/gross weights.
 * Configurable via environment variables; falls back to sensible defaults.
 *
 * Values are in kilograms.
 */

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? fallback : parsed;
}

export const WEIGHT_BOUNDS = {
  TARE_MIN_KG: envInt("TARE_MIN_KG", 3_000),
  TARE_MAX_KG: envInt("TARE_MAX_KG", 25_000),
  GROSS_MIN_KG: envInt("GROSS_MIN_KG", 5_000),
  GROSS_MAX_KG: envInt("GROSS_MAX_KG", 70_000),
  NET_MIN_KG: envInt("NET_MIN_KG", 500),
} as const;

export function validateTareWeight(kg: number): string | null {
  if (kg < WEIGHT_BOUNDS.TARE_MIN_KG) {
    return `وزن الفارغ (${kg.toLocaleString("ar-SY")} كغ) أقل من الحد الأدنى المسموح (${WEIGHT_BOUNDS.TARE_MIN_KG.toLocaleString("ar-SY")} كغ)`;
  }
  if (kg > WEIGHT_BOUNDS.TARE_MAX_KG) {
    return `وزن الفارغ (${kg.toLocaleString("ar-SY")} كغ) أكبر من الحد الأقصى المسموح (${WEIGHT_BOUNDS.TARE_MAX_KG.toLocaleString("ar-SY")} كغ)`;
  }
  return null;
}

export function validateGrossWeight(kg: number, tareKg?: number | null): string | null {
  if (kg < WEIGHT_BOUNDS.GROSS_MIN_KG) {
    return `وزن المحمّل (${kg.toLocaleString("ar-SY")} كغ) أقل من الحد الأدنى المسموح (${WEIGHT_BOUNDS.GROSS_MIN_KG.toLocaleString("ar-SY")} كغ)`;
  }
  if (kg > WEIGHT_BOUNDS.GROSS_MAX_KG) {
    return `وزن المحمّل (${kg.toLocaleString("ar-SY")} كغ) أكبر من الحد الأقصى المسموح (${WEIGHT_BOUNDS.GROSS_MAX_KG.toLocaleString("ar-SY")} كغ)`;
  }
  if (tareKg != null) {
    const net = kg - tareKg;
    if (net < WEIGHT_BOUNDS.NET_MIN_KG) {
      return `صافي الوزن (${net.toLocaleString("ar-SY")} كغ) أقل من الحد الأدنى المسموح (${WEIGHT_BOUNDS.NET_MIN_KG.toLocaleString("ar-SY")} كغ)`;
    }
  }
  return null;
}
