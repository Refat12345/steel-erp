import type { TruckStatus } from "@prisma/client";

/** Business invariant: operational day runs cutoff→cutoff (Damascus VPS local). */
export const OPERATIONAL_DAY_CUTOFF_HOUR = 8;
export const OPERATIONAL_TIMEZONE = "Asia/Damascus";

/** Tons — matches scale card cross-verification highlight. */
export const REPORT_DISCREPANCY_WARN_TONS = 0.5;

export type ReportTonnageStatus =
  | "included"
  | "excluded_late_close"
  | "excluded_cancelled"
  | "excluded_open";

export interface OperationalDayWindow {
  /** Calendar date the user selected (YYYY-MM-DD). */
  operationalDate: string;
  /** Inclusive start of the operational window (local). */
  from: Date;
  /** Exclusive end of the operational window (local). */
  to: Date;
}

const DATE_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD` into local calendar parts. */
export function parseOperationalDateInput(dateStr: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = DATE_INPUT_RE.exec(dateStr.trim());
  if (!match) {
    throw new Error("INVALID_OPERATIONAL_DATE");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(year, month - 1, day);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    throw new Error("INVALID_OPERATIONAL_DATE");
  }
  return { year, month, day };
}

/**
 * Operational day D spans [D cutoff, D+1 cutoff) in the server local
 * timezone (Asia/Damascus on production).
 */
export function getOperationalDayWindow(
  dateStr: string,
  cutoffHour: number = OPERATIONAL_DAY_CUTOFF_HOUR,
): OperationalDayWindow {
  const { year, month, day } = parseOperationalDateInput(dateStr);
  const from = new Date(year, month - 1, day, cutoffHour, 0, 0, 0);
  const to = new Date(year, month - 1, day + 1, cutoffHour, 0, 0, 0);
  return { operationalDate: dateStr, from, to };
}

export function isWithinOperationalWindow(
  ts: Date,
  window: OperationalDayWindow,
): boolean {
  return ts >= window.from && ts < window.to;
}

export function resolveReportTonnageStatus(params: {
  status: TruckStatus;
  closedAt: Date | null;
  window: OperationalDayWindow;
}): ReportTonnageStatus {
  const { status, closedAt, window } = params;

  if (status === "Cancelled") {
    return "excluded_cancelled";
  }
  if (status !== "Completed") {
    return "excluded_open";
  }
  if (!closedAt || closedAt >= window.to) {
    return "excluded_late_close";
  }
  return "included";
}

export function computeBridgeTons(
  grossWeightKg: unknown,
  tareWeightKg: unknown,
): number | null {
  if (grossWeightKg == null || tareWeightKg == null) {
    return null;
  }
  const gross = Number(grossWeightKg);
  const tare = Number(tareWeightKg);
  if (!Number.isFinite(gross) || !Number.isFinite(tare)) {
    return null;
  }
  const net = (gross - tare) / 1000;
  return net > 0 ? Math.round(net * 1000) / 1000 : null;
}

export function computeInternalTons(
  sessions: ReadonlyArray<{ weightTons: unknown }>,
): number | null {
  if (sessions.length === 0) {
    return null;
  }
  let sum = 0;
  for (const s of sessions) {
    const w = Number(s.weightTons);
    if (!Number.isFinite(w)) continue;
    sum += w;
  }
  return Math.round(sum * 1000) / 1000;
}

export function computeDiscrepancyTons(
  bridgeTons: number | null,
  internalTons: number | null,
): number | null {
  if (bridgeTons == null || internalTons == null) {
    return null;
  }
  return Math.round((bridgeTons - internalTons) * 1000) / 1000;
}

/** Default operational date input for UI (before cutoff → previous calendar day). */
export function defaultOperationalDateInput(
  now: Date = new Date(),
  cutoffHour: number = OPERATIONAL_DAY_CUTOFF_HOUR,
): string {
  const cutoff = new Date(now);
  cutoff.setHours(cutoffHour, 0, 0, 0);
  const d = new Date(now);
  if (now < cutoff) {
    d.setDate(d.getDate() - 1);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatOperationalWindowLabel(window: OperationalDayWindow): string {
  const fmt = (d: Date) =>
    d.toLocaleString("ar-SY", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return `${fmt(window.from)} → ${fmt(window.to)}`;
}
