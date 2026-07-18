/**
 * Weight reasonableness bounds for tare/gross weights.
 *
 * Two layers of defence:
 *   1. Hard rails (MIN_WEIGHT_KG / MAX_WEIGHT_KG) — absolute clamps that
 *      NEVER change per deployment. Used by validators to reject obviously
 *      absurd values (e.g. 0, negative, 10 million) before any other logic.
 *   2. Deployment-specific bounds (tare/gross/net) — configurable via env.
 *      Capture "what weights are plausible at THIS plant"; tighter than the
 *      hard rails unless aligned with them (gross defaults to MAX_WEIGHT_KG).
 *
 * All values are in kilograms.
 *
 * Validation failures return messageKey + params (translated at the API
 * boundary) — never localized prose.
 */

import type { MessageKeyError } from "@/lib/services/errors";

/**
 * Absolute minimum for any individual weight reading.
 * 100 kg rejects sensor-noise, near-zero phantom readings, and typos like
 * entering tons instead of kilograms for a number less than 100.
 */
export const MIN_WEIGHT_KG = 100;

/**
 * Absolute maximum for any individual weight reading.
 * 100 000 kg (100 t) is larger than any road-legal truck anywhere and safely
 * bounds the Decimal(10,1) column range so Prisma never hits a DB overflow.
 */
export const MAX_WEIGHT_KG = 100_000;

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function clampBound(kind: "min" | "max", value: number): number {
  if (kind === "min") return Math.max(MIN_WEIGHT_KG, value);
  return Math.min(MAX_WEIGHT_KG, value);
}

export const WEIGHT_BOUNDS = {
  TARE_MIN_KG: clampBound("min", envInt("TARE_MIN_KG", 3_000)),
  TARE_MAX_KG: clampBound("max", envInt("TARE_MAX_KG", MAX_WEIGHT_KG)),
  GROSS_MIN_KG: clampBound("min", envInt("GROSS_MIN_KG", 5_000)),
  GROSS_MAX_KG: clampBound("max", envInt("GROSS_MAX_KG", MAX_WEIGHT_KG)),
  NET_MIN_KG: Math.max(1, envInt("NET_MIN_KG", 500)),
} as const;

function fmt(kg: number): string {
  return kg.toLocaleString("en-US");
}

/** Hard-rail check applied to every weight value before deployment bounds. */
export function validateWeightRange(kg: number): MessageKeyError | null {
  if (!Number.isFinite(kg)) return { messageKey: "weightValueInvalid" };
  if (kg < MIN_WEIGHT_KG) {
    return {
      messageKey: "weightBelowMin",
      params: { kg: fmt(kg), minKg: fmt(MIN_WEIGHT_KG) },
    };
  }
  if (kg > MAX_WEIGHT_KG) {
    return {
      messageKey: "weightAboveMax",
      params: { kg: fmt(kg), maxKg: fmt(MAX_WEIGHT_KG) },
    };
  }
  return null;
}

export function validateTareWeight(kg: number): MessageKeyError | null {
  const hardError = validateWeightRange(kg);
  if (hardError) return hardError;
  if (kg < WEIGHT_BOUNDS.TARE_MIN_KG) {
    return {
      messageKey: "tareWeightBelowMin",
      params: { kg: fmt(kg), minKg: fmt(WEIGHT_BOUNDS.TARE_MIN_KG) },
    };
  }
  if (kg > WEIGHT_BOUNDS.TARE_MAX_KG) {
    return {
      messageKey: "tareWeightAboveMax",
      params: { kg: fmt(kg), maxKg: fmt(WEIGHT_BOUNDS.TARE_MAX_KG) },
    };
  }
  return null;
}

export function validateGrossWeight(
  kg: number,
  tareKg?: number | null,
): MessageKeyError | null {
  const hardError = validateWeightRange(kg);
  if (hardError) return hardError;
  if (kg < WEIGHT_BOUNDS.GROSS_MIN_KG) {
    return {
      messageKey: "grossWeightBelowMin",
      params: { kg: fmt(kg), minKg: fmt(WEIGHT_BOUNDS.GROSS_MIN_KG) },
    };
  }
  if (kg > WEIGHT_BOUNDS.GROSS_MAX_KG) {
    return {
      messageKey: "grossWeightAboveMax",
      params: { kg: fmt(kg), maxKg: fmt(WEIGHT_BOUNDS.GROSS_MAX_KG) },
    };
  }
  if (tareKg != null) {
    if (kg <= tareKg) {
      return {
        messageKey: "grossMustExceedTare",
        params: { kg: fmt(kg), tareKg: fmt(tareKg) },
      };
    }
    const net = kg - tareKg;
    if (net < WEIGHT_BOUNDS.NET_MIN_KG) {
      return {
        messageKey: "netWeightBelowMin",
        params: { netKg: fmt(net), minKg: fmt(WEIGHT_BOUNDS.NET_MIN_KG) },
      };
    }
  }
  return null;
}
