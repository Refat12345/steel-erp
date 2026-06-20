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
} from "@/lib/operational-day";
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
    const d = new Date(today);
    d.setDate(d.getDate() - 6);
    return d;
  }
  const d = new Date(today);
  d.setDate(d.getDate() - 29);
  return d;
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
  | "BILLET_WIRE";

const KIND_LABELS: Record<MaterialKind, string> = {
  REBAR: "مبروم",
  SHORTBAR_1_4M: "قصائر 1–4 م",
  SHORTBAR_4_12M: "قصائر 4–12 م",
  SCRAP: "خردة",
  BILLET_WIRE: "أسلاك تربيط",
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

// ─── Types: Owner Tier ────────────────────────────────────────────────

export interface OwnerKpis {
  completedTrucks: number;
  totalTons: number;
  servedCustomers: number;
  servedDestinations: number;
}

export interface DailyActivityPoint {
  date: string;
  label: string;
  trucks: number;
  tons: number;
}

export interface NamedTotal {
  id: number;
  name: string;
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
  kpis: OwnerKpis;
  activity14d: DailyActivityPoint[];
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

// ─── Owner Tier Builder ───────────────────────────────────────────────

async function buildOwnerStats(period: DashboardPeriod): Promise<OwnerStats> {
  const now = new Date();
  const from = periodStart(period, now);
  const fourteenStart = new Date(operationalDayStart(now));
  fourteenStart.setDate(fourteenStart.getDate() - 13);
  const thirtyStart = new Date(operationalDayStart(now));
  thirtyStart.setDate(thirtyStart.getDate() - 29);

  // All completed trucks in [from, now) and in [fourteenStart, now) and in [thirtyStart, now)
  // are fetched in a single Promise.all batch alongside their joined entities.
  const [completedInPeriod, completed14d, completed30d] = await Promise.all([
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
      },
    }),
    prisma.truckOperation.findMany({
      where: {
        status: "Completed",
        closedAt: { gte: fourteenStart },
      },
      select: {
        grossWeightKg: true,
        tareWeightKg: true,
        closedAt: true,
      },
    }),
    prisma.truckOperation.findMany({
      where: {
        status: "Completed",
        closedAt: { gte: thirtyStart },
      },
      select: {
        id: true,
        customerId: true,
        destinationId: true,
        grossWeightKg: true,
        tareWeightKg: true,
        sessions: {
          select: {
            weightTons: true,
            size: { select: { code: true } },
          },
        },
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

  // ── 14-day activity ────────────────────────────────────────────────
  const dayMap = new Map<string, { trucks: number; tons: number }>();
  for (let i = 0; i < 14; i++) {
    const d = new Date(fourteenStart);
    d.setDate(d.getDate() + i);
    const key = operationalDateKey(d);
    dayMap.set(key, { trucks: 0, tons: 0 });
  }
  for (const t of completed14d) {
    if (!t.closedAt) continue;
    const key = operationalDateKey(new Date(t.closedAt));
    const slot = dayMap.get(key);
    if (!slot) continue;
    slot.trucks += 1;
    slot.tons += netTonnage(t.grossWeightKg, t.tareWeightKg);
  }
  const activity14d: DailyActivityPoint[] = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      label: dayLabel(getOperationalDayWindow(date).from),
      trucks: v.trucks,
      tons: Math.round(v.tons * 1000) / 1000,
    }));

  // ── Top customers / destinations (30d by tonnage) ──────────────────
  const custTons = new Map<number, number>();
  const destTons = new Map<number, number>();
  const kindTons = new Map<MaterialKind, number>();
  const gradeTons = new Map<SalesOrderGrade, number>();

  for (const t of completed30d) {
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
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: number; name: string }[]),
  ]);

  const customerMap = new Map(customerRows.map((c) => [c.id, c]));
  const destMap = new Map(destRows.map((d) => [d.id, d]));

  const topCustomers: NamedTotal[] = topCustomerIds.map((id) => ({
    id,
    name: customerMap.get(id)?.fullName ?? `زبون #${id}`,
    code: customerMap.get(id)?.code ?? "",
    tons: Math.round((custTons.get(id) ?? 0) * 1000) / 1000,
  }));

  const topDestinations: NamedTotal[] = topDestIds.map((id) => ({
    id,
    name: destMap.get(id)?.name ?? `وجهة #${id}`,
    tons: Math.round((destTons.get(id) ?? 0) * 1000) / 1000,
  }));

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
    kpis,
    activity14d,
    topCustomers,
    topDestinations,
    tonsByKind,
    tonsByGrade,
  };
}

// ─── Ops Tier Builder ─────────────────────────────────────────────────

async function buildOpsStats(): Promise<OpsStats> {
  const now = new Date();
  const thirtyStart = new Date(operationalDayStart(now));
  thirtyStart.setDate(thirtyStart.getDate() - 29);

  const [statusGroups, activeTrucks, completed30d, cancelled30d] =
    await Promise.all([
      // Status breakdown across ALL trucks (small table, full scan is fine).
      prisma.truckOperation.groupBy({
        by: ["status"],
        _count: { status: true },
      }),
      // Live snapshot of every truck currently mid-flight.
      prisma.truckOperation.findMany({
        where: { status: { in: ACTIVE_STATUSES } },
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
    ["operations-dashboard-owner", period],
    { revalidate: OWNER_CACHE_TTL_SECONDS },
  )();
}

export async function getOpsStatsCached(): Promise<OpsStats> {
  return unstable_cache(() => buildOpsStats(), ["operations-dashboard-ops"], {
    revalidate: OPS_CACHE_TTL_SECONDS,
  })();
}
