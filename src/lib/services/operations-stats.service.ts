/**
 * ─── Operations Dashboard Stats Service ───────────────────────────────
 *
 * Read-only aggregator that powers the new operations-focused KPI
 * dashboard (`/api/dashboard/operations-stats`). Replaces the legacy
 * sales/finance-driven payload while those modules are not yet in
 * production use.
 *
 * Two tiers of data, returned independently so a route handler can
 * compose them based on the caller's permission set:
 *
 *   1. OWNER tier (everyone with `dashboard.view`) — calm, results-only
 *      metrics: completed trucks, tonnage delivered, top customers /
 *      destinations / kinds, grade mix. NEVER includes alerts, queue
 *      lengths, cycle-time anomalies, cancellation ratios, or "live
 *      now" counters that could be misread as alarm signals.
 *
 *   2. OPS tier (additionally requires `dashboard.ops.view`) —
 *      operationally sensitive metrics: live fleet status, on-scale
 *      queue, average cycle/tare/loading times, cancellation rate,
 *      stuck-truck list with thresholds.
 *
 * Both tiers are cached for 30 seconds via `unstable_cache`. The cache
 * key includes the time-window so the same payload is shared across
 * concurrent viewers within the window.
 *
 * Why not cache them as one combined payload? Keeping them separate
 * lets the route handler skip the OPS query entirely for users that
 * don't have `dashboard.ops.view`, so the Owner role never even pays
 * the latency cost of an aggregate they will not see.
 * ─────────────────────────────────────────────────────────────────────
 */

import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/date-format";
import {
  defaultOperationalDateInput,
  getOperationalDayWindow,
  getReportPeriodWindow,
  OPERATIONAL_DAY_CUTOFF_HOUR,
} from "@/lib/operational-day";
import {
  DASHBOARD_STATS_CACHE_TAG,
  getAnalyticsStartDateValue,
} from "@/lib/services/settings.service";
import type { TruckStatus, SalesOrderGrade } from "@prisma/client";

// ─── Period & Time Helpers ─────────────────────────────────────────────

export type DashboardPeriod = "today" | "week" | "month";

/** Server-local operational day start: 08:00→08:00 (Damascus on production). */
function operationalDayStart(now: Date): Date {
  return getOperationalDayWindow(defaultOperationalDateInput(now)).from;
}

function periodStart(period: DashboardPeriod, now: Date = new Date()): Date {
  const today = operationalDayStart(now);
  if (period === "today") return today;
  if (period === "week") {
    // Levant calendar week: Saturday 08:00 → next Saturday 08:00
    // (same convention as weekly reports). "هذا الأسبوع" = current week
    // from its Saturday, not a rolling last-7-days window.
    return getReportPeriodWindow(operationalDateKey(now), "weekly").from;
  }
  // Calendar month: 1st of the current operational month at the 08:00 cutoff
  // (not a rolling 30-day window — "هذا الشهر" means the month itself).
  const key = operationalDateKey(now);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return new Date(year, month - 1, 1, OPERATIONAL_DAY_CUTOFF_HOUR, 0, 0, 0);
}

function operationalDateKey(date: Date): string {
  return defaultOperationalDateInput(date);
}

// ─── Constants ────────────────────────────────────────────────────────

/** Active operational statuses — a truck is "in flight" if it sits in any of
 *  these. Completed and Cancelled are terminal. */
const ACTIVE_STATUSES: TruckStatus[] = [
  "Queued",
  "Approved",
  "FirstWeigh",
  "Loading",
  "OnScale",
  "LoadingComplete",
  "SecondWeigh",
];

/** Stuck-truck thresholds in minutes per status. A truck whose status has
 *  been unchanged longer than this is surfaced as a soft alert.
 *
 *  TODO: move to a `Settings` table when we introduce one — keeping these as
 *  code constants for v1 is acceptable because they are operational alert
 *  thresholds (not per-entity ratios/limits). */
const STUCK_THRESHOLDS_MIN: Partial<Record<TruckStatus, number>> = {
  Queued: 60,
  Approved: 30,
  FirstWeigh: 20,
  Loading: 90,
  OnScale: 30,
  LoadingComplete: 45,
  SecondWeigh: 20,
};

const STATUS_LABELS: Record<TruckStatus, string> = {
  Queued: "بالطابور",
  Approved: "معتمدة",
  FirstWeigh: "وزن أوّلي",
  Loading: "قيد التحميل",
  OnScale: "على الميزان",
  LoadingComplete: "انتهاء التحميل",
  SecondWeigh: "وزن ثاني",
  Completed: "مكتملة",
  Cancelled: "ملغاة",
};

const STATUS_COLORS: Record<TruckStatus, string> = {
  Queued: "#94a3b8",
  Approved: "#3b82f6",
  FirstWeigh: "#06b6d4",
  Loading: "#f59e0b",
  OnScale: "#a855f7",
  LoadingComplete: "#22c55e",
  SecondWeigh: "#0ea5e9",
  Completed: "#10b981",
  Cancelled: "#ef4444",
};

type MaterialKind =
  | "REBAR"
  | "SHORTBAR_1_4M"
  | "SHORTBAR_4_12M"
  | "SCRAP"
  | "BILLET_WIRE"
  | "REBAR_UNDER_70CM"
  | "BILLET_SCRAP_10M"
  | "SCRAP_50CM_1M";

const KIND_LABELS: Record<MaterialKind, string> = {
  REBAR: "مبروم",
  SHORTBAR_1_4M: "قصائر 1–4 م",
  SHORTBAR_4_12M: "قصائر 4–12 م",
  SCRAP: "خردة",
  BILLET_WIRE: "أسلاك تربيط",
  REBAR_UNDER_70CM: "مبروم أقل من 70 سم",
  BILLET_SCRAP_10M: "بيلت خردة 10m",
  SCRAP_50CM_1M: "سكراب من 50 سم إلى 1 م",
};

const GRADE_LABELS: Record<SalesOrderGrade, string> = {
  FIRST: "درجة أولى",
  SECOND: "درجة ثانية",
};

/** Map a SizeLookup.code to the high-level material kind. Mirrors the
 *  `SalesOrderKind` enum used in the legacy sales dashboard. Anything
 *  not matching falls through to REBAR (digit-prefixed mm codes). */
function sizeCodeToKind(code: string): MaterialKind {
  if (code === "shortbar_1_4m") return "SHORTBAR_1_4M";
  if (code === "shortbar_4_12m") return "SHORTBAR_4_12M";
  if (code === "scrap") return "SCRAP";
  if (code === "billet_wire_6mm") return "BILLET_WIRE";
  if (code === "rebar_under_70cm") return "REBAR_UNDER_70CM";
  if (code === "billet_scrap_10m") return "BILLET_SCRAP_10M";
  if (code === "scrap_50cm_1m") return "SCRAP_50CM_1M";
  return "REBAR";
}

// ─── Common Helpers ───────────────────────────────────────────────────

/** Net delivered tonnage for a single completed truck:
 *  (grossKg − tareKg) / 1000, clamped at 0 so a malformed pair never
 *  contributes a negative number to a positive-only KPI. */
function netTonnage(grossKg: unknown, tareKg: unknown): number {
  const g = Number(grossKg ?? 0);
  const t = Number(tareKg ?? 0);
  const net = (g - t) / 1000;
  return net > 0 ? net : 0;
}

function dayLabel(d: Date): string {
  return formatDate(d);
}

function computeTrend(current: number, previous: number): KpiTrend {
  if (previous <= 0) {
    // No baseline: a jump from 0 has no meaningful percentage.
    return { pct: null, direction: current > 0 ? "up" : "flat" };
  }
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  return {
    pct,
    direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat",
  };
}

// ─── Types: Owner Tier ────────────────────────────────────────────────

export interface OwnerKpis {
  completedTrucks: number;
  totalTons: number;
  servedCustomers: number;
  servedDestinations: number;
}

/** Trend of one KPI vs the equivalent slice of the previous period.
 *  `pct` is null when the previous value was 0 (no meaningful ratio). */
export interface KpiTrend {
  pct: number | null;
  direction: "up" | "down" | "flat";
}

export interface OwnerTrends {
  completedTrucks: KpiTrend;
  totalTons: KpiTrend;
  servedCustomers: KpiTrend;
  servedDestinations: KpiTrend;
}

/** Live floor snapshot for the hero banner — answers "what is happening
 *  inside the plant right now?" without any historical comparison. */
export interface FactoryLiveFloor {
  /** Every non-terminal truck currently inside the plant. */
  activeNow: number;
  /** Trucks still waiting for their turn (Queued + Approved). */
  queuedNow: number;
  /** Trucks on the internal weighbridge (OnScale). */
  loadingNow: number;
  /** Tare done, not yet loading — external weighbridge / FirstWeigh. */
  tareNow: number;
  /** Soft alerts: trucks idle past their status threshold. */
  stuckNow: number;
  /** Longest-dwell active truck (null when the floor is empty). */
  longestDwell: {
    plateNumber: string;
    statusLabel: string;
    minutesSince: number;
  } | null;
}

/** Hero-banner payload: today's running total + live floor snapshot.
 *  `bestDay` is the record BEFORE today, so a broken record stays visibly
 *  "broken" for the rest of the day instead of the target silently moving
 *  to today's own total. */
export interface FactoryPulse {
  todayTons: number;
  todayTrucks: number;
  bestDay: { date: string; label: string; tons: number } | null;
  /** todayTons as % of the record (may exceed 100). Null without a record. */
  pctOfRecord: number | null;
  recordBroken: boolean;
  liveFloor: FactoryLiveFloor;
}

export interface RecentDelivery {
  id: number;
  plateNumber: string;
  tons: number;
  customerName: string | null;
  closedAt: string;
}

export type ActivityGranularity = "hour" | "day";

export interface ActivityPoint {
  /** Bucket key: operational date (YYYY-MM-DD) or hour label (HH:00). */
  key: string;
  label: string;
  trucks: number;
  tons: number;
}

/** Period-driven activity series: hourly buckets for "today"
 *  (cutoff-ordered 08:00 → 07:00), daily buckets for week/month. */
export interface ActivitySeries {
  granularity: ActivityGranularity;
  points: ActivityPoint[];
}

export interface NamedTotal {
  id: number;
  name: string;
  /** Present for destinations; API localizes `name` from this when set. */
  nameEn?: string | null;
  code?: string;
  tons: number;
}

export interface KindTotal {
  kind: MaterialKind;
  label: string;
  tons: number;
}

export interface GradeTotal {
  grade: SalesOrderGrade;
  label: string;
  tons: number;
}

export interface OwnerStats {
  period: DashboardPeriod;
  /** Configured analytics start (YYYY-MM-DD) — null when the dashboard
   *  computes over the full history. Surfaced so the UI can disclose it. */
  analyticsStartDate: string | null;
  kpis: OwnerKpis;
  trends: OwnerTrends;
  pulse: FactoryPulse;
  recentDeliveries: RecentDelivery[];
  activity: ActivitySeries;
  topCustomers: NamedTotal[];
  topDestinations: NamedTotal[];
  tonsByKind: KindTotal[];
  tonsByGrade: GradeTotal[];
}

// ─── Types: Ops Tier ──────────────────────────────────────────────────

export interface FleetStatusBucket {
  status: TruckStatus;
  label: string;
  color: string;
  count: number;
}

export interface OnScaleItem {
  id: number;
  plateNumber: string;
  status: TruckStatus;
  statusLabel: string;
  enteredAt: string;
  minutesSince: number;
}

export interface StuckTruckItem {
  id: number;
  plateNumber: string;
  status: TruckStatus;
  statusLabel: string;
  thresholdMin: number;
  minutesSince: number;
  since: string;
}

export interface OpsAverages {
  avgCycleMin: number | null;
  avgWaitBeforeTareMin: number | null;
  avgLoadingMin: number | null;
}

export interface OpsKpis {
  activeNow: number;
  onScaleNow: number;
  stuckNow: number;
  cancellationPct30d: number | null;
}

export interface OpsStats {
  kpis: OpsKpis;
  fleetStatus: FleetStatusBucket[];
  onScale: OnScaleItem[];
  averages30d: OpsAverages;
  stuckTrucks: StuckTruckItem[];
}

// ─── Best-Day Record (all-time) ───────────────────────────────────────

/** Scan completed history and return the highest-tonnage operational day
 *  strictly BEFORE `todayKey` (today competes against the record, it is
 *  never its own baseline). Cached for 5 minutes per operational day —
 *  the record only changes once a day at the cutoff. */
async function computeBestDayBefore(
  todayKey: string,
  analyticsStart: Date | null,
): Promise<{ date: string; tons: number } | null> {
  const completed = await prisma.truckOperation.findMany({
    where: {
      status: "Completed",
      closedAt: analyticsStart
        ? { not: null, gte: analyticsStart }
        : { not: null },
    },
    select: {
      grossWeightKg: true,
      tareWeightKg: true,
      closedAt: true,
    },
  });

  const dayTons = new Map<string, number>();
  for (const t of completed) {
    if (!t.closedAt) continue;
    const key = operationalDateKey(new Date(t.closedAt));
    if (key >= todayKey) continue;
    dayTons.set(
      key,
      (dayTons.get(key) ?? 0) + netTonnage(t.grossWeightKg, t.tareWeightKg),
    );
  }

  let best: { date: string; tons: number } | null = null;
  for (const [date, tons] of dayTons) {
    if (!best || tons > best.tons) best = { date, tons };
  }
  return best
    ? { date: best.date, tons: Math.round(best.tons * 1000) / 1000 }
    : null;
}

const BEST_DAY_CACHE_TTL_SECONDS = 300;

function getBestDayCached(todayKey: string, analyticsStartValue: string | null) {
  return unstable_cache(
    () =>
      computeBestDayBefore(todayKey, analyticsStartInstant(analyticsStartValue)),
    ["operations-dashboard-best-day", todayKey, analyticsStartValue ?? "-"],
    {
      revalidate: BEST_DAY_CACHE_TTL_SECONDS,
      tags: [DASHBOARD_STATS_CACHE_TAG],
    },
  )();
}

/** Parse the stored YYYY-MM-DD into the 08:00 cutoff instant. Malformed
 *  values degrade to "no filter" — analytics must never crash on config. */
function analyticsStartInstant(value: string | null): Date | null {
  if (!value) return null;
  try {
    return getOperationalDayWindow(value).from;
  } catch {
    return null;
  }
}

// ─── Owner Tier Builder ───────────────────────────────────────────────

async function buildOwnerStats(period: DashboardPeriod): Promise<OwnerStats> {
  const now = new Date();

  // Admin-configured analytics start: everything closed before this
  // instant is invisible to the dashboard (kept intact in DB/reports).
  const analyticsStartValue = await getAnalyticsStartDateValue();
  const analyticsStart = analyticsStartInstant(analyticsStartValue);
  const clampToStart = (d: Date): Date =>
    analyticsStart && d < analyticsStart ? analyticsStart : d;

  const rawFrom = periodStart(period, now);
  const from = clampToStart(rawFrom);

  // Previous-period window for trend arrows. Elapsed-equivalent slice:
  // "today at 11:00" vs "yesterday up to 11:00"; for calendar week/month,
  // mirror into the previous calendar unit from its true start (Saturday /
  // 1st) — never a roll-back of a possibly-clamped `from`.
  let prevFrom: Date;
  let prevTo: Date;
  if (period === "month") {
    prevFrom = new Date(rawFrom);
    prevFrom.setMonth(prevFrom.getMonth() - 1);
    prevTo = new Date(prevFrom.getTime() + (now.getTime() - rawFrom.getTime()));
  } else if (period === "week") {
    prevFrom = new Date(rawFrom);
    prevFrom.setDate(prevFrom.getDate() - 7);
    prevTo = new Date(prevFrom.getTime() + (now.getTime() - rawFrom.getTime()));
  } else {
    prevFrom = new Date(from);
    prevFrom.setDate(prevFrom.getDate() - 1);
    prevTo = new Date(prevFrom.getTime() + (now.getTime() - from.getTime()));
  }

  // A trend arrow is only honest when the whole comparison window lies
  // inside the trusted range — otherwise it compares against the excluded
  // (test/rollout) era and produces fantasy percentages.
  const prevWindowClean = !analyticsStart || prevFrom >= analyticsStart;

  const currentOpDay = operationalDateKey(now);

  // One period-scoped dataset drives every owner-tier widget (KPIs,
  // activity series, top customers/destinations, kind & grade mixes) so
  // the whole dashboard answers to the same today/week/month filter.
  const [
    completedInPeriod,
    prevPeriod,
    recentCompleted,
    bestDay,
    activeFloor,
  ] = await Promise.all([
    prisma.truckOperation.findMany({
      where: {
        status: "Completed",
        closedAt: { gte: from },
      },
      select: {
        id: true,
        customerId: true,
        destinationId: true,
        grossWeightKg: true,
        tareWeightKg: true,
        closedAt: true,
        operationalGrade: true,
        rounds: {
          select: {
            grade: true,
            startWeightKg: true,
            endWeightKg: true,
          },
        },
        sessions: {
          select: {
            weightTons: true,
            size: { select: { code: true } },
          },
        },
      },
    }),
    prisma.truckOperation.findMany({
      where: {
        status: "Completed",
        closedAt: { gte: prevFrom, lt: prevTo },
      },
      select: {
        customerId: true,
        destinationId: true,
        grossWeightKg: true,
        tareWeightKg: true,
      },
    }),
    // Live-ticker feed: last completed trucks, newest first.
    prisma.truckOperation.findMany({
      where: {
        status: "Completed",
        closedAt: analyticsStart
          ? { not: null, gte: analyticsStart }
          : { not: null },
      },
      orderBy: { closedAt: "desc" },
      take: 10,
      select: {
        id: true,
        plateNumber: true,
        grossWeightKg: true,
        tareWeightKg: true,
        closedAt: true,
        customer: { select: { fullName: true } },
      },
    }),
    getBestDayCached(currentOpDay, analyticsStartValue),
    // Live floor: every truck currently mid-flight inside the plant.
    // Registration is floored at the analytics start — stale pre-rollout
    // trucks abandoned in an active status must not inflate live counters.
    prisma.truckOperation.findMany({
      where: {
        status: { in: ACTIVE_STATUSES },
        ...(analyticsStart ? { createdAt: { gte: analyticsStart } } : {}),
      },
      select: {
        plateNumber: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  // ── KPIs (selected period) ─────────────────────────────────────────
  const customers = new Set<number>();
  const destinations = new Set<number>();
  let totalTons = 0;
  for (const t of completedInPeriod) {
    totalTons += netTonnage(t.grossWeightKg, t.tareWeightKg);
    if (t.customerId != null) customers.add(t.customerId);
    if (t.destinationId != null) destinations.add(t.destinationId);
  }
  const kpis: OwnerKpis = {
    completedTrucks: completedInPeriod.length,
    totalTons: Math.round(totalTons * 1000) / 1000,
    servedCustomers: customers.size,
    servedDestinations: destinations.size,
  };

  // ── Trends vs the equivalent slice of the previous period ──────────
  const prevCustomers = new Set<number>();
  const prevDestinations = new Set<number>();
  let prevTons = 0;
  for (const t of prevPeriod) {
    prevTons += netTonnage(t.grossWeightKg, t.tareWeightKg);
    if (t.customerId != null) prevCustomers.add(t.customerId);
    if (t.destinationId != null) prevDestinations.add(t.destinationId);
  }
  const NO_TREND: KpiTrend = { pct: null, direction: "flat" };
  const trends: OwnerTrends = prevWindowClean
    ? {
        completedTrucks: computeTrend(kpis.completedTrucks, prevPeriod.length),
        totalTons: computeTrend(kpis.totalTons, prevTons),
        servedCustomers: computeTrend(kpis.servedCustomers, prevCustomers.size),
        servedDestinations: computeTrend(
          kpis.servedDestinations,
          prevDestinations.size,
        ),
      }
    : {
        // Comparison window overlaps the excluded era → no arrows at all.
        completedTrucks: NO_TREND,
        totalTons: NO_TREND,
        servedCustomers: NO_TREND,
        servedDestinations: NO_TREND,
      };

  // ── Factory pulse (today vs all-time record) ────────────────────────
  // Every period window starts at or before today's cutoff, so today's
  // slice can always be derived from the period dataset without an
  // extra query.
  const todayStart = operationalDayStart(now);
  let todayTons = 0;
  let todayTrucks = 0;
  for (const t of completedInPeriod) {
    if (!t.closedAt || new Date(t.closedAt) < todayStart) continue;
    todayTons += netTonnage(t.grossWeightKg, t.tareWeightKg);
    todayTrucks += 1;
  }
  todayTons = Math.round(todayTons * 1000) / 1000;

  // ── Live floor snapshot (hero "الآن في المصنع") ─────────────────────
  let queuedNow = 0;
  let loadingNow = 0;
  let tareNow = 0;
  let stuckNow = 0;
  let longestDwell: FactoryLiveFloor["longestDwell"] = null;
  for (const t of activeFloor) {
    if (t.status === "Queued" || t.status === "Approved") queuedNow += 1;
    // OnScale = internal weighbridge during loading sessions.
    if (t.status === "OnScale") loadingNow += 1;
    // FirstWeigh = tare recorded on the external weighbridge, not yet loading.
    if (t.status === "FirstWeigh") tareNow += 1;
    const ref = t.updatedAt ?? t.createdAt;
    const minutesSince = Math.round(
      Math.max(0, now.getTime() - new Date(ref).getTime()) / 60000,
    );
    const threshold = STUCK_THRESHOLDS_MIN[t.status];
    if (threshold != null && minutesSince >= threshold) stuckNow += 1;
    if (!longestDwell || minutesSince > longestDwell.minutesSince) {
      longestDwell = {
        plateNumber: t.plateNumber,
        statusLabel: STATUS_LABELS[t.status],
        minutesSince,
      };
    }
  }
  const liveFloor: FactoryLiveFloor = {
    activeNow: activeFloor.length,
    queuedNow,
    loadingNow,
    tareNow,
    stuckNow,
    longestDwell,
  };

  const pulse: FactoryPulse = {
    todayTons,
    todayTrucks,
    bestDay: bestDay
      ? {
          date: bestDay.date,
          label: dayLabel(getOperationalDayWindow(bestDay.date).from),
          tons: bestDay.tons,
        }
      : null,
    pctOfRecord:
      bestDay && bestDay.tons > 0
        ? Math.round((todayTons / bestDay.tons) * 1000) / 10
        : null,
    recordBroken: bestDay !== null && bestDay.tons > 0 && todayTons > bestDay.tons,
    liveFloor,
  };

  const recentDeliveries: RecentDelivery[] = recentCompleted
    .filter((t) => t.closedAt != null)
    .map((t) => ({
      id: t.id,
      plateNumber: t.plateNumber,
      tons: Math.round(netTonnage(t.grossWeightKg, t.tareWeightKg) * 1000) / 1000,
      customerName: t.customer?.fullName ?? null,
      closedAt: new Date(t.closedAt as Date).toISOString(),
    }));

  // ── Activity series (period-driven) ─────────────────────────────────
  // "today" → 24 hourly buckets ordered from the 08:00 cutoff;
  // week/month → one bucket per operational day.
  let activity: ActivitySeries;
  if (period === "today") {
    const hourMap = new Map<number, { trucks: number; tons: number }>();
    for (let i = 0; i < 24; i++) {
      hourMap.set((OPERATIONAL_DAY_CUTOFF_HOUR + i) % 24, { trucks: 0, tons: 0 });
    }
    for (const t of completedInPeriod) {
      if (!t.closedAt) continue;
      const slot = hourMap.get(new Date(t.closedAt).getHours());
      if (!slot) continue;
      slot.trucks += 1;
      slot.tons += netTonnage(t.grossWeightKg, t.tareWeightKg);
    }
    activity = {
      granularity: "hour",
      points: Array.from(hourMap.entries()).map(([hour, v]) => ({
        key: String(hour),
        label: `${String(hour).padStart(2, "0")}:00`,
        trucks: v.trucks,
        tons: Math.round(v.tons * 1000) / 1000,
      })),
    };
  } else {
    // `from` is already clamped to the analytics start, so when the
    // period window crosses the start the series simply begins there —
    // no misleading zero-days from the excluded era. Walk day-by-day
    // until today so calendar-month windows (1st → today) size correctly.
    const dayMap = new Map<string, { trucks: number; tons: number }>();
    for (
      let d = new Date(from);
      operationalDateKey(d) <= currentOpDay && dayMap.size < 62;
      d.setDate(d.getDate() + 1)
    ) {
      dayMap.set(operationalDateKey(d), { trucks: 0, tons: 0 });
    }
    for (const t of completedInPeriod) {
      if (!t.closedAt) continue;
      const slot = dayMap.get(operationalDateKey(new Date(t.closedAt)));
      if (!slot) continue;
      slot.trucks += 1;
      slot.tons += netTonnage(t.grossWeightKg, t.tareWeightKg);
    }
    activity = {
      granularity: "day",
      points: Array.from(dayMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({
          key: date,
          label: dayLabel(getOperationalDayWindow(date).from),
          trucks: v.trucks,
          tons: Math.round(v.tons * 1000) / 1000,
        })),
    };
  }

  // ── Top customers / destinations / kinds (selected period) ─────────
  const custTons = new Map<number, number>();
  const destTons = new Map<number, number>();
  const kindTons = new Map<MaterialKind, number>();
  const gradeTons = new Map<SalesOrderGrade, number>();

  for (const t of completedInPeriod) {
    const net = netTonnage(t.grossWeightKg, t.tareWeightKg);
    if (t.customerId != null) {
      custTons.set(t.customerId, (custTons.get(t.customerId) ?? 0) + net);
    }
    if (t.destinationId != null) {
      destTons.set(t.destinationId, (destTons.get(t.destinationId) ?? 0) + net);
    }
    // Kind from weigh sessions (size codes) — preferred over salesOrder.kind
    // because trucks may operate without a linked SalesOrder.
    for (const s of t.sessions) {
      if (!s.size) continue;
      const kind = sizeCodeToKind(s.size.code);
      const tons = Number(s.weightTons ?? 0);
      kindTons.set(kind, (kindTons.get(kind) ?? 0) + tons);
    }
  }

  // Grade tonnage comes from bridge rounds: each round carries its own
  // grade and its net (end − start) is the authoritative external weight
  // of that batch. Single-round trucks behave exactly as before (round 1
  // inherits the operation-level grade), while multi-round trucks split
  // their tonnage correctly between grades. Trucks predating the rounds
  // migration without rounds fall back to the operation-level grade.
  for (const t of completedInPeriod) {
    if (t.rounds.length > 0) {
      for (const r of t.rounds) {
        if (!r.grade || r.endWeightKg == null) continue;
        const net = netTonnage(r.endWeightKg, r.startWeightKg);
        gradeTons.set(r.grade, (gradeTons.get(r.grade) ?? 0) + net);
      }
    } else if (t.operationalGrade) {
      const net = netTonnage(t.grossWeightKg, t.tareWeightKg);
      gradeTons.set(
        t.operationalGrade,
        (gradeTons.get(t.operationalGrade) ?? 0) + net,
      );
    }
  }

  const topCustomerIds = Array.from(custTons.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([id]) => id);
  const topDestIds = Array.from(destTons.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([id]) => id);

  const [customerRows, destRows] = await Promise.all([
    topCustomerIds.length
      ? prisma.customer.findMany({
          where: { id: { in: topCustomerIds } },
          select: { id: true, fullName: true, code: true },
        })
      : Promise.resolve([] as { id: number; fullName: string; code: string }[]),
    topDestIds.length
      ? prisma.destination.findMany({
          where: { id: { in: topDestIds } },
          select: { id: true, name: true, nameEn: true },
        })
      : Promise.resolve(
          [] as { id: number; name: string; nameEn: string | null }[],
        ),
  ]);

  const customerMap = new Map(customerRows.map((c) => [c.id, c]));
  const destMap = new Map(destRows.map((d) => [d.id, d]));

  const topCustomers: NamedTotal[] = topCustomerIds.map((id) => ({
    id,
    name: customerMap.get(id)?.fullName ?? `زبون #${id}`,
    code: customerMap.get(id)?.code ?? "",
    tons: Math.round((custTons.get(id) ?? 0) * 1000) / 1000,
  }));

  const topDestinations: NamedTotal[] = topDestIds.map((id) => {
    const dest = destMap.get(id);
    return {
      id,
      name: dest?.name ?? `وجهة #${id}`,
      nameEn: dest?.nameEn ?? null,
      tons: Math.round((destTons.get(id) ?? 0) * 1000) / 1000,
    };
  });

  const tonsByKind: KindTotal[] = (
    Object.keys(KIND_LABELS) as MaterialKind[]
  )
    .map((kind) => ({
      kind,
      label: KIND_LABELS[kind],
      tons: Math.round((kindTons.get(kind) ?? 0) * 1000) / 1000,
    }))
    .filter((k) => k.tons > 0);

  const tonsByGrade: GradeTotal[] = (
    Object.keys(GRADE_LABELS) as SalesOrderGrade[]
  )
    .map((grade) => ({
      grade,
      label: GRADE_LABELS[grade],
      tons: Math.round((gradeTons.get(grade) ?? 0) * 1000) / 1000,
    }))
    .filter((g) => g.tons > 0);

  return {
    period,
    analyticsStartDate: analyticsStartValue,
    kpis,
    trends,
    pulse,
    recentDeliveries,
    activity,
    topCustomers,
    topDestinations,
    tonsByKind,
    tonsByGrade,
  };
}

// ─── Ops Tier Builder ─────────────────────────────────────────────────

async function buildOpsStats(): Promise<OpsStats> {
  const now = new Date();

  // Same analytics-start clamp as the owner tier: 30-day averages and the
  // cancellation ratio must not mix in the excluded (pre-rollout) era.
  const analyticsStart = analyticsStartInstant(
    await getAnalyticsStartDateValue(),
  );
  const thirtyStart = new Date(operationalDayStart(now));
  thirtyStart.setDate(thirtyStart.getDate() - 29);
  if (analyticsStart && thirtyStart < analyticsStart) {
    thirtyStart.setTime(analyticsStart.getTime());
  }

  const [statusGroups, activeTrucks, completed30d, cancelled30d] =
    await Promise.all([
      // Status breakdown, floored at the analytics start everywhere:
      // terminal statuses by their end timestamps, active ones by
      // registration — stale pre-rollout trucks abandoned mid-flight
      // must not appear in the pie.
      prisma.truckOperation.groupBy({
        by: ["status"],
        where: analyticsStart
          ? {
              OR: [
                {
                  status: { in: ACTIVE_STATUSES },
                  createdAt: { gte: analyticsStart },
                },
                { status: "Completed", closedAt: { gte: analyticsStart } },
                { status: "Cancelled", updatedAt: { gte: analyticsStart } },
              ],
            }
          : {},
        _count: { status: true },
      }),
      // Live snapshot of every truck currently mid-flight (same floor).
      prisma.truckOperation.findMany({
        where: {
          status: { in: ACTIVE_STATUSES },
          ...(analyticsStart ? { createdAt: { gte: analyticsStart } } : {}),
        },
        select: {
          id: true,
          plateNumber: true,
          status: true,
          createdAt: true,
          tareTime: true,
          loadingConfirmedAt: true,
          grossTime: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.truckOperation.findMany({
        where: {
          status: "Completed",
          closedAt: { gte: thirtyStart },
        },
        select: {
          createdAt: true,
          tareTime: true,
          loadingConfirmedAt: true,
          grossTime: true,
          closedAt: true,
        },
      }),
      prisma.truckOperation.count({
        where: {
          status: "Cancelled",
          updatedAt: { gte: thirtyStart },
        },
      }),
    ]);

  // ── Fleet status buckets (every status, even with 0) ──────────────
  const statusCountMap = new Map<TruckStatus, number>(
    statusGroups.map((g) => [g.status, g._count.status]),
  );
  const fleetStatus: FleetStatusBucket[] = (
    Object.keys(STATUS_LABELS) as TruckStatus[]
  )
    .map((status) => ({
      status,
      label: STATUS_LABELS[status],
      color: STATUS_COLORS[status],
      count: statusCountMap.get(status) ?? 0,
    }))
    .filter((b) => b.count > 0);

  // ── Live counters ─────────────────────────────────────────────────
  let activeNow = 0;
  let onScaleNow = 0;
  for (const b of fleetStatus) {
    if (ACTIVE_STATUSES.includes(b.status)) activeNow += b.count;
    if (b.status === "OnScale") onScaleNow += b.count;
  }

  // ── On-scale list (live) ──────────────────────────────────────────
  const onScale: OnScaleItem[] = activeTrucks
    .filter((t) => t.status === "OnScale")
    .map((t) => {
      const ref = t.updatedAt ?? t.createdAt;
      const ms = Math.max(0, now.getTime() - new Date(ref).getTime());
      return {
        id: t.id,
        plateNumber: t.plateNumber,
        status: t.status,
        statusLabel: STATUS_LABELS[t.status],
        enteredAt: new Date(ref).toISOString(),
        minutesSince: Math.round(ms / 60000),
      };
    })
    .sort((a, b) => b.minutesSince - a.minutesSince);

  // ── Stuck trucks (per-status threshold) ───────────────────────────
  const stuckTrucks: StuckTruckItem[] = activeTrucks
    .map((t) => {
      const threshold = STUCK_THRESHOLDS_MIN[t.status];
      if (!threshold) return null;
      const ref = t.updatedAt ?? t.createdAt;
      const minutes = Math.round(
        Math.max(0, now.getTime() - new Date(ref).getTime()) / 60000,
      );
      if (minutes < threshold) return null;
      return {
        id: t.id,
        plateNumber: t.plateNumber,
        status: t.status,
        statusLabel: STATUS_LABELS[t.status],
        thresholdMin: threshold,
        minutesSince: minutes,
        since: new Date(ref).toISOString(),
      };
    })
    .filter((x): x is StuckTruckItem => x !== null)
    .sort((a, b) => b.minutesSince - a.minutesSince);

  // ── Time averages over 30d (only fully completed trucks) ──────────
  let cycleSum = 0;
  let cycleCnt = 0;
  let waitSum = 0;
  let waitCnt = 0;
  let loadSum = 0;
  let loadCnt = 0;
  for (const t of completed30d) {
    if (t.createdAt && t.closedAt) {
      cycleSum += new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime();
      cycleCnt += 1;
    }
    if (t.createdAt && t.tareTime) {
      waitSum += new Date(t.tareTime).getTime() - new Date(t.createdAt).getTime();
      waitCnt += 1;
    }
    if (t.tareTime && t.loadingConfirmedAt) {
      loadSum +=
        new Date(t.loadingConfirmedAt).getTime() - new Date(t.tareTime).getTime();
      loadCnt += 1;
    }
  }
  const averages30d: OpsAverages = {
    avgCycleMin: cycleCnt ? Math.round(cycleSum / cycleCnt / 60000) : null,
    avgWaitBeforeTareMin: waitCnt ? Math.round(waitSum / waitCnt / 60000) : null,
    avgLoadingMin: loadCnt ? Math.round(loadSum / loadCnt / 60000) : null,
  };

  // ── Cancellation ratio (30d) ──────────────────────────────────────
  const completed30dCount = completed30d.length;
  const denom = completed30dCount + cancelled30d;
  const cancellationPct30d =
    denom > 0 ? Math.round((cancelled30d / denom) * 1000) / 10 : null;

  const kpis: OpsKpis = {
    activeNow,
    onScaleNow,
    stuckNow: stuckTrucks.length,
    cancellationPct30d,
  };

  return { kpis, fleetStatus, onScale, averages30d, stuckTrucks };
}

// ─── Cached entry points ──────────────────────────────────────────────

const OWNER_CACHE_TTL_SECONDS = 30;
const OPS_CACHE_TTL_SECONDS = 30;

export async function getOwnerStatsCached(
  period: DashboardPeriod,
): Promise<OwnerStats> {
  return unstable_cache(
    () => buildOwnerStats(period),
    // v6: live-floor counters floored at the analytics start.
    ["operations-dashboard-owner-v6", period],
    {
      revalidate: OWNER_CACHE_TTL_SECONDS,
      tags: [DASHBOARD_STATS_CACHE_TAG],
    },
  )();
}

export async function getOpsStatsCached(): Promise<OpsStats> {
  return unstable_cache(() => buildOpsStats(), ["operations-dashboard-ops"], {
    revalidate: OPS_CACHE_TTL_SECONDS,
    tags: [DASHBOARD_STATS_CACHE_TAG],
  })();
}
