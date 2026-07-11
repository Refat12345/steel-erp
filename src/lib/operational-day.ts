import type { TruckStatus } from "@prisma/client";

/** Business invariant: operational day runs cutoff→cutoff (Damascus VPS local). */
import { formatDateTime } from "@/lib/date-format";

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

export type ReportPeriod = "daily" | "weekly" | "monthly";

export const REPORT_PERIODS: readonly ReportPeriod[] = [
  "daily",
  "weekly",
  "monthly",
] as const;

/**
 * Operational window for a daily / weekly / monthly report, anchored on the
 * selected calendar date and aligned to the cutoff hour.
 *
 *  - daily:   [D cutoff, D+1 cutoff)
 *  - weekly:  the week (Sat→Sat, Levant convention) containing D
 *  - monthly: the calendar month containing D
 *
 * Returned `from`/`to` are local Dates, identical in shape to
 * `getOperationalDayWindow`, so all tonnage/status helpers work unchanged.
 */
export function getReportPeriodWindow(
  dateStr: string,
  period: ReportPeriod,
  cutoffHour: number = OPERATIONAL_DAY_CUTOFF_HOUR,
): OperationalDayWindow {
  const { year, month, day } = parseOperationalDateInput(dateStr);

  if (period === "weekly") {
    // getDay(): Sun=0 … Sat=6. Distance back to the most recent Saturday.
    const anchor = new Date(year, month - 1, day);
    const offsetToSaturday = (anchor.getDay() - 6 + 7) % 7;
    const from = new Date(
      year,
      month - 1,
      day - offsetToSaturday,
      cutoffHour,
      0,
      0,
      0,
    );
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    return { operationalDate: dateStr, from, to };
  }

  if (period === "monthly") {
    const from = new Date(year, month - 1, 1, cutoffHour, 0, 0, 0);
    const to = new Date(year, month, 1, cutoffHour, 0, 0, 0);
    return { operationalDate: dateStr, from, to };
  }

  return getOperationalDayWindow(dateStr, cutoffHour);
}

/** Maximum span for arbitrary date-range reports (inclusive days). */
export const REPORT_RANGE_MAX_DAYS = 366;

/**
 * Operational window for an arbitrary date range [fromDate, toDate]
 * (both inclusive calendar dates), aligned to the cutoff hour:
 * [fromDate cutoff, toDate+1 cutoff).
 *
 * Throws `INVALID_OPERATIONAL_DATE` on malformed dates,
 * `INVALID_RANGE_ORDER` when from > to, and `RANGE_TOO_LARGE` when the
 * span exceeds `REPORT_RANGE_MAX_DAYS`.
 */
export function getReportRangeWindow(
  fromStr: string,
  toStr: string,
  cutoffHour: number = OPERATIONAL_DAY_CUTOFF_HOUR,
): OperationalDayWindow {
  const fromParts = parseOperationalDateInput(fromStr);
  const toParts = parseOperationalDateInput(toStr);

  const from = new Date(
    fromParts.year,
    fromParts.month - 1,
    fromParts.day,
    cutoffHour,
    0,
    0,
    0,
  );
  const to = new Date(
    toParts.year,
    toParts.month - 1,
    toParts.day + 1,
    cutoffHour,
    0,
    0,
    0,
  );

  if (to <= from) {
    throw new Error("INVALID_RANGE_ORDER");
  }
  const spanDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
  if (spanDays > REPORT_RANGE_MAX_DAYS) {
    throw new Error("RANGE_TOO_LARGE");
  }

  return { operationalDate: fromStr, from, to };
}

/** Local `YYYY-MM-DD` of a Date (used to label report period ranges). */
export function formatLocalDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
  return `${formatDateTime(window.from)} → ${formatDateTime(window.to)}`;
}
