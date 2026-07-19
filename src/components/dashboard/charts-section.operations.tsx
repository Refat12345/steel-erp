"use client";

/**
 * ─── Operations KPI Dashboard ─────────────────────────────────────────
 *
 * Live dashboard for the v1 roll-out (Trucks + Scale modules only).
 * Renders two tiers of content composed by `/api/dashboard/operations-stats`:
 *
 *   • OWNER tier — always rendered. Shows completed-truck KPIs for the
 *     selected period (today / week / month), day compare, top
 *     customers, top destinations, kind mix.
 *
 *   • OPS tier — rendered only when the API response contains an `ops`
 *     payload (i.e. the caller holds `dashboard.ops.view`). Shows live
 *     fleet status, on-scale queue, 30-day cycle-time averages,
 *     cancellation %, and the stuck-truck alert list.
 *
 * The legacy sales/finance dashboard is preserved verbatim in
 * `charts-section.sales.tsx` (not imported) and ready to swap back
 * once the finance module goes live.
 * ─────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  MapPin,
  Minus,
  Package,
  PieChart as PieIcon,
  // Sparkles, // used by FactoryPulseBanner (temporarily hidden)
  Timer,
  TrendingDown,
  TrendingUp,
  // Trophy, // used by FactoryPulseBanner (temporarily hidden)
  Truck,
  Users,
  Weight,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type DashboardT = ReturnType<typeof useTranslations<"dashboard">>;
type EnumsT = ReturnType<typeof useTranslations<"enums">>;

// ─── Types — mirror the API response ──────────────────────────────────

type Period = "today" | "week" | "month";

type TruckStatus =
  | "Queued"
  | "Approved"
  | "FirstWeigh"
  | "Loading"
  | "OnScale"
  | "LoadingComplete"
  | "SecondWeigh"
  | "Completed"
  | "Cancelled";

interface KpiTrend {
  pct: number | null;
  direction: "up" | "down" | "flat";
}

interface FactoryLiveFloor {
  activeNow: number;
  queuedNow: number;
  loadingNow: number;
  tareNow: number;
  stuckNow: number;
  longestDwell: {
    plateNumber: string;
    statusLabel: string;
    minutesSince: number;
  } | null;
}

interface FactoryPulse {
  todayTons: number;
  todayTrucks: number;
  bestDay: { date: string; label: string; tons: number } | null;
  pctOfRecord: number | null;
  recordBroken: boolean;
  liveFloor: FactoryLiveFloor;
}

interface OwnerStats {
  period: Period;
  analyticsStartDate: string | null;
  kpis: {
    completedTrucks: number;
    totalTons: number;
    servedCustomers: number;
    servedDestinations: number;
  };
  trends: {
    completedTrucks: KpiTrend;
    totalTons: KpiTrend;
    servedCustomers: KpiTrend;
    servedDestinations: KpiTrend;
  };
  pulse: FactoryPulse;
  activity: {
    granularity: "hour" | "day";
    points: { key: string; label: string; trucks: number; tons: number }[];
  };
  topCustomers: { id: number; name: string; code?: string; tons: number }[];
  topDestinations: { id: number; name: string; tons: number }[];
  tonsByKind: { kind: string; label: string; tons: number }[];
  tonsByGrade: { grade: string; label: string; tons: number }[];
}

interface OpsStats {
  kpis: {
    activeNow: number;
    onScaleNow: number;
    stuckNow: number;
    cancellationPct30d: number | null;
  };
  fleetStatus: {
    status: TruckStatus;
    label: string;
    color: string;
    count: number;
  }[];
  onScale: {
    id: number;
    plateNumber: string;
    status: TruckStatus;
    statusLabel: string;
    minutesSince: number;
  }[];
  averages30d: {
    avgCycleMin: number | null;
    avgWaitBeforeTareMin: number | null;
    avgLoadingMin: number | null;
  };
  stuckTrucks: {
    id: number;
    plateNumber: string;
    status: TruckStatus;
    statusLabel: string;
    thresholdMin: number;
    minutesSince: number;
  }[];
}

interface ApiResponse {
  success: boolean;
  data: {
    owner: OwnerStats;
    ops: OpsStats | null;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatTons(v: number, tonsUnit: string): string {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v)} ${tonsUnit}`;
}

function formatTonsCompact(v: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(v);
}

function formatMinutes(min: number | null, t: DashboardT): string {
  if (min === null || min === undefined) return "—";
  if (min < 60) return t("units.minutesShort", { n: min });
  if (min < 1440) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (m === 0) return t("units.hoursShort", { h });
    return t("units.hoursMinutes", { h, m });
  }
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  if (h === 0) return t("units.daysShort", { d });
  return t("units.daysHours", { d, h });
}

const MATERIAL_KINDS = [
  "REBAR",
  "SHORTBAR_1_4M",
  "SHORTBAR_4_12M",
  "SCRAP",
  "BILLET_WIRE",
  "REBAR_UNDER_70CM",
  "BILLET_SCRAP_10M",
  "SCRAP_50CM_1M",
] as const;

function truckStatusLabel(status: TruckStatus, tEnums: EnumsT): string {
  return tEnums(`truckStatus.${status}`);
}

function materialKindLabel(
  kind: string,
  fallback: string,
  tEnums: EnumsT,
): string {
  if ((MATERIAL_KINDS as readonly string[]).includes(kind)) {
    return tEnums(`materialKind.${kind as (typeof MATERIAL_KINDS)[number]}`);
  }
  return fallback;
}

const LIVE_REFRESH_MS = 60_000;

/** HH:MM:SS with latin digits for the live "last updated" badge. */
const timeFormatter = new Intl.DateTimeFormat("en-GB-u-nu-latn", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const KIND_COLORS: Record<string, string> = {
  REBAR: "#3b82f6",
  SHORTBAR_1_4M: "#8b5cf6",
  SHORTBAR_4_12M: "#a855f7",
  SCRAP: "#f97316",
  BILLET_WIRE: "#14b8a6",
  REBAR_UNDER_70CM: "#a855f7",
  BILLET_SCRAP_10M: "#f97316",
  SCRAP_50CM_1M: "#84cc16",
};

const TOP_BAR_COLORS = [
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
];

// ─── Reusable bits ─────────────────────────────────────────────────────

function SectionLabel({
  icon: Icon,
  label,
}: {
  icon: React.ElementType;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Animates a number from its previous value to `target` with an
 * ease-out curve (~0.9s). Returns `null` while the target is unknown so
 * the caller can render a placeholder. Re-animates on every target
 * change, which also makes live refreshes visibly "tick" to new values.
 */
function useCountUp(target: number | null, duration = 900): number | null {
  const [display, setDisplay] = useState<number | null>(target);
  const latest = useRef(0);

  useEffect(() => {
    // All state writes go through rAF: never set state synchronously
    // inside the effect (avoids cascading render warnings).
    if (target === null) {
      const raf = requestAnimationFrame(() => setDisplay(null));
      return () => cancelAnimationFrame(raf);
    }
    const from = latest.current;
    if (from === target) {
      const raf = requestAnimationFrame(() => setDisplay(target));
      return () => cancelAnimationFrame(raf);
    }
    let raf: number;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * eased;
      latest.current = v;
      setDisplay(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return display;
}

function TrendBadge({
  trend,
  compareLabel,
}: {
  trend?: KpiTrend;
  compareLabel: string;
}) {
  const t = useTranslations("dashboard");
  if (!trend) return null;

  if (trend.pct === null) {
    // No previous-period baseline (previous value was 0).
    if (trend.direction === "up") {
      return (
        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
          <TrendingUp className="h-3 w-3 shrink-0" />
          {t("trend.newActivity")}
        </span>
      );
    }
    return null;
  }

  const up = trend.direction === "up";
  const flat = trend.direction === "flat";
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const cls = flat
    ? "bg-muted text-muted-foreground"
    : up
      ? "bg-emerald-500/10 text-emerald-600"
      : "bg-red-500/10 text-red-600";
  const pctLabel = flat
    ? t("trend.flatPercent")
    : up
      ? t("trend.percentUp", { pct: Math.abs(trend.pct) })
      : t("trend.percentDown", { pct: Math.abs(trend.pct) });

  return (
    <span className="mt-1.5 inline-flex flex-wrap items-center gap-1">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${cls}`}
      >
        <Icon className="h-3 w-3 shrink-0" />
        {pctLabel}
      </span>
      <span className="text-[10px] text-muted-foreground">{compareLabel}</span>
    </span>
  );
}

// ─── Factory Pulse (hero banner) ───────────────────────────────────────

/* ── FactoryPulseBanner — temporarily hidden; restore later ──────────
function FactoryPulseBanner({
  pulse,
  loading,
}: {
  pulse?: FactoryPulse;
  loading: boolean;
}) {
  const animatedTons = useCountUp(pulse ? pulse.todayTons : null);

  if (loading && !pulse) {
    return (
      <div className="h-40 animate-pulse rounded-2xl bg-muted" aria-hidden />
    );
  }
  if (!pulse?.liveFloor) return null;

  const record = pulse.recordBroken;
  const floor = pulse.liveFloor;
  const background = record
    ? "linear-gradient(135deg, #713f12 0%, #b45309 45%, #92400e 100%)"
    : "linear-gradient(135deg, oklch(0.230 0.050 250) 0%, oklch(0.330 0.095 238) 55%, oklch(0.270 0.075 232) 100%)";

  return (
    <div
      className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 relative overflow-hidden rounded-2xl p-5 text-white shadow-lg sm:p-6"
      style={{ background }}
    >
      // Subtle blueprint grid so the banner reads "control room", not flat color
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {record && (
        <>
          <Sparkles className="absolute start-4 top-3 h-5 w-5 animate-pulse text-amber-200" />
          <Sparkles className="absolute bottom-3 end-24 h-4 w-4 animate-pulse text-amber-200 [animation-delay:400ms]" />
        </>
      )}

      <div className="relative flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:justify-between">
        // ── Today's running total ──
        <div className="flex flex-col items-center gap-1.5 text-center sm:items-start sm:text-start">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-white/80">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            إنتاج اليوم حتى الآن — مباشر
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-extrabold tabular-nums leading-none sm:text-6xl">
              {formatTonsCompact(animatedTons ?? pulse.todayTons)}
            </span>
            <span className="text-lg font-semibold text-white/80">طن</span>
          </div>
          <p className="text-xs text-white/70">
            حمولة {pulse.todayTrucks} شاحنة مكتملة منذ 08:00 صباحاً
          </p>

          {record && pulse.bestDay && (
            <div className="mt-1 inline-flex items-center gap-2 rounded-full bg-amber-300/20 px-3 py-1.5 text-xs font-bold text-amber-100 ring-1 ring-amber-300/50">
              <Trophy className="h-4 w-4 animate-bounce text-amber-300" />
              رقم قياسي جديد! تجاوزتم أفضل يوم مسجل ({formatTons(pulse.bestDay.tons)})
            </div>
          )}
        </div>

        // ── Live floor: شاحنات في هذه اللحظة ──
        <div className="flex w-full flex-col items-center gap-2 text-center sm:w-auto sm:min-w-[17rem] sm:items-end sm:text-end">
          <div className="grid w-full grid-cols-2 gap-2">
            <LiveFloorStat
              value={floor.loadingNow}
              label="شاحنة تُحمَّل داخل المعمل"
              accent="text-amber-200"
            />
            <LiveFloorStat
              value={floor.tareNow}
              label="شاحنة على القبان الخارجي"
              accent="text-cyan-200"
            />
          </div>
          <span className="flex items-center gap-1.5 text-[11px] text-white/70">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            الوضع في هذه اللحظة داخل المصنع
          </span>
        </div>
      </div>
    </div>
  );
}

function LiveFloorStat({
  value,
  label,
  accent,
}: {
  value: number;
  label: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl bg-white/10 px-2 py-2 ring-1 ring-white/10">
      <div className={`text-2xl font-extrabold tabular-nums leading-none ${accent}`}>
        {value}
      </div>
      <div className="mt-1 text-[10px] leading-tight text-white/70">{label}</div>
    </div>
  );
}
── end FactoryPulseBanner ────────────────────────────────────────── */

function KpiCard({
  title,
  value,
  numericValue,
  formatValue,
  trend,
  trendCompareLabel,
  sub,
  icon: Icon,
  color,
  colorBg,
  colorRing,
}: {
  title: string;
  value: string;
  numericValue?: number | null;
  formatValue?: (v: number) => string;
  trend?: KpiTrend;
  trendCompareLabel?: string;
  sub: string;
  icon: React.ElementType;
  color: string;
  colorBg: string;
  colorRing: string;
}) {
  const t = useTranslations("dashboard");
  const animated = useCountUp(numericValue ?? null);
  const display =
    numericValue != null && formatValue
      ? formatValue(animated ?? numericValue)
      : value;

  return (
    <Card className="group gap-0 overflow-hidden pt-0 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
      <div
        className="h-[3px] w-full shrink-0 transition-all duration-300 group-hover:h-1"
        style={{ background: color }}
      />
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2 pt-5">
        <CardTitle className="text-sm font-medium leading-snug text-muted-foreground">
          {title}
        </CardTitle>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110"
          style={{
            background: colorBg,
            boxShadow: `inset 0 0 0 1px ${colorRing}`,
          }}
        >
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
      </CardHeader>
      <CardContent className="pb-5">
        <div
          className="financial-value text-3xl font-bold tracking-tight tabular-nums"
          style={{ color }}
        >
          {display}
        </div>
        <TrendBadge
          trend={trend}
          compareLabel={trendCompareLabel ?? t("periodCompare.previous")}
        />
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

function ChartSkeleton({ h = 240 }: { h?: number }) {
  return (
    <div
      className="animate-pulse rounded-lg bg-muted"
      style={{ height: h }}
    />
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-52 items-center justify-center text-xs text-muted-foreground">
      {label}
    </div>
  );
}

// ─── Period Toggle ─────────────────────────────────────────────────────

function PeriodToggle({
  value,
  onChange,
  disabled,
}: {
  value: Period;
  onChange: (p: Period) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("dashboard");
  const options: Period[] = ["today", "week", "month"];
  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-card p-1 shadow-sm">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <UiTooltip key={opt}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(opt)}
                  className={[
                    "px-3 py-1.5 text-xs font-semibold rounded-md transition-all",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                    disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                  ].join(" ")}
                />
              }
            >
              {t(`period.${opt}`)}
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-center leading-relaxed">
              {t(`periodHint.${opt}`)}
            </TooltipContent>
          </UiTooltip>
        );
      })}
    </div>
  );
}

// ─── Tooltips ──────────────────────────────────────────────────────────

function CountTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { value: number; name: string }[];
}) {
  const t = useTranslations("dashboard");
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs">
      <p className="font-semibold text-foreground">{payload[0].name}</p>
      <p className="text-muted-foreground">
        <span className="font-bold text-primary">{payload[0].value}</span>{" "}
        {t("units.truck")}
      </p>
    </div>
  );
}

function TonsBarTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  const t = useTranslations("dashboard");
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      <p className="text-muted-foreground">
        <span className="font-bold text-primary">
          {formatTons(payload[0].value, t("units.tons"))}
        </span>
      </p>
    </div>
  );
}

function TruncatedYTick({
  x,
  y,
  payload,
  maxChars = 10,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  maxChars?: number;
}) {
  const raw = payload?.value ?? "";
  const text = raw.length > maxChars ? raw.slice(0, maxChars) + "…" : raw;
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={4}
        textAnchor="end"
        fill="hsl(var(--muted-foreground))"
        fontSize={10}
      >
        {text}
      </text>
    </g>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export function ChartsSection() {
  const t = useTranslations("dashboard");
  const tEnums = useTranslations("enums");
  const [period, setPeriod] = useState<Period>("today");
  const [data, setData] = useState<ApiResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const periodLabel = t(`period.${period}`);
  const tonsUnit = t("units.tons");

  // Period changes flow through this event handler so the loading/error
  // resets happen synchronously with the user gesture — not inside the
  // effect body, which would trigger react-hooks/set-state-in-effect.
  function handlePeriodChange(next: Period) {
    if (next === period) return;
    setLoading(true);
    setError(null);
    // Drop the previous period snapshot so period-specific widgets never
    // render against a mismatched payload while the next fetch is in flight.
    setData(null);
    setPeriod(next);
  }

  useEffect(() => {
    let cancelled = false;
    let initialLoad = true;

    function load() {
      const silent = !initialLoad;
      initialLoad = false;
      // no-store: stats must never be served from the browser HTTP cache —
      // stale JSON here made the dashboard show old data until a hard refresh.
      fetch(`/api/dashboard/operations-stats?period=${period}`, {
        cache: "no-store",
      })
        .then((r) => r.json())
        .then((j: ApiResponse) => {
          if (cancelled) return;
          if (!j.success) {
            // Silent refresh failures keep the last good snapshot on
            // screen instead of flashing an error over live data.
            if (!silent) setError(t("errorLoad"));
            return;
          }
          setError(null);
          setData(j.data);
          setLastUpdated(new Date());
        })
        .catch(() => {
          if (!cancelled && !silent) setError(t("errorNetwork"));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    load();
    const timer = setInterval(load, LIVE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [period, t]);

  const owner = data?.owner;
  const ops = data?.ops;

  const compareLabel = t(`periodCompare.${period}`);

  const tonsByKindLocalized =
    owner?.tonsByKind.map((entry) => ({
      ...entry,
      label: materialKindLabel(entry.kind, entry.label, tEnums),
    })) ?? [];

  const fleetStatusLocalized =
    ops?.fleetStatus.map((entry) => ({
      ...entry,
      label: truckStatusLabel(entry.status, tEnums),
    })) ?? [];

  // ── Owner KPI cards (4) ──────────────────────────────────────────────
  const ownerKpis = [
    {
      title: t("kpis.completedTrucks", { period: periodLabel }),
      value: "—",
      numericValue: owner ? owner.kpis.completedTrucks : null,
      formatValue: (v: number) => String(Math.round(v)),
      trend: owner?.trends.completedTrucks,
      sub: t("kpis.completedTrucksSub"),
      icon: Truck,
      color: "oklch(0.390 0.130 232)",
      colorBg: "oklch(0.390 0.130 232 / 12%)",
      colorRing: "oklch(0.390 0.130 232 / 25%)",
    },
    {
      title: t("kpis.totalTons", { period: periodLabel }),
      value: "—",
      numericValue: owner ? owner.kpis.totalTons : null,
      formatValue: formatTonsCompact,
      trend: owner?.trends.totalTons,
      sub: owner
        ? t("kpis.totalTonsDelivered", {
            tons: formatTons(owner.kpis.totalTons, tonsUnit),
          })
        : "—",
      icon: Weight,
      color: "oklch(0.630 0.155 152)",
      colorBg: "oklch(0.630 0.155 152 / 12%)",
      colorRing: "oklch(0.630 0.155 152 / 25%)",
    },
    {
      title: t("kpis.servedCustomers"),
      value: "—",
      numericValue: owner ? owner.kpis.servedCustomers : null,
      formatValue: (v: number) => String(Math.round(v)),
      trend: owner?.trends.servedCustomers,
      sub: t("kpis.duringPeriod", { period: periodLabel }),
      icon: Users,
      color: "oklch(0.720 0.150 65)",
      colorBg: "oklch(0.720 0.150 65 / 14%)",
      colorRing: "oklch(0.720 0.150 65 / 28%)",
    },
    {
      title: t("kpis.servedDestinations"),
      value: "—",
      numericValue: owner ? owner.kpis.servedDestinations : null,
      formatValue: (v: number) => String(Math.round(v)),
      trend: owner?.trends.servedDestinations,
      sub: t("kpis.duringPeriod", { period: periodLabel }),
      icon: MapPin,
      color: "oklch(0.610 0.210 0)",
      colorBg: "oklch(0.610 0.210 0 / 12%)",
      colorRing: "oklch(0.610 0.210 0 / 25%)",
    },
  ];

  return (
    <div className="space-y-10">
      {/* ── Factory pulse hero (temporarily hidden; restore later) ─
      <FactoryPulseBanner pulse={owner?.pulse} loading={loading} />
      */}

      {/* ── Header: live badge + period toggle ───────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            {t("live")}
            {lastUpdated && (
              <span className="font-normal text-muted-foreground tabular-nums">
                {t("lastUpdated", { time: timeFormatter.format(lastUpdated) })}
              </span>
            )}
          </span>
          <p className="text-xs text-muted-foreground">
            {t("periodNote")}
          </p>
        </div>
        <PeriodToggle
          value={period}
          onChange={handlePeriodChange}
          disabled={loading}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ── Owner KPI cards ──────────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-2 lg:grid-cols-4">
        {ownerKpis.map((card) => (
          <div
            key={card.title}
            className="animate-in fade-in-0 slide-in-from-bottom-4 duration-500"
          >
            <KpiCard {...card} trendCompareLabel={compareLabel} />
          </div>
        ))}
      </div>

      {/* ── OPS KPIs (only if `ops` present) ──────────────────────── */}
      {ops && (
        <>
          <SectionLabel icon={Gauge} label={t("sections.opsStatus")} />
          <div className="grid gap-4 grid-cols-2 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title={t("kpis.activeNow")}
              value="—"
              numericValue={ops.kpis.activeNow}
              formatValue={(v) => String(Math.round(v))}
              sub={t("kpis.activeNowSub")}
              icon={Activity}
              color="oklch(0.620 0.175 222)"
              colorBg="oklch(0.620 0.175 222 / 12%)"
              colorRing="oklch(0.620 0.175 222 / 25%)"
            />
            <KpiCard
              title={t("kpis.onScaleNow")}
              value="—"
              numericValue={ops.kpis.onScaleNow}
              formatValue={(v) => String(Math.round(v))}
              sub={t("kpis.onScaleNowSub")}
              icon={Weight}
              color="oklch(0.650 0.190 290)"
              colorBg="oklch(0.650 0.190 290 / 12%)"
              colorRing="oklch(0.650 0.190 290 / 25%)"
            />
            <KpiCard
              title={t("kpis.stuckTrucks")}
              value="—"
              numericValue={ops.kpis.stuckNow}
              formatValue={(v) => String(Math.round(v))}
              sub={t("kpis.stuckTrucksSub")}
              icon={AlertTriangle}
              color="oklch(0.700 0.180 50)"
              colorBg="oklch(0.700 0.180 50 / 12%)"
              colorRing="oklch(0.700 0.180 50 / 25%)"
            />
            <KpiCard
              title={t("kpis.cancellationPct")}
              value={
                ops.kpis.cancellationPct30d === null
                  ? "—"
                  : t("trend.percentValue", {
                      value: ops.kpis.cancellationPct30d,
                    })
              }
              sub={t("kpis.cancellationPctSub")}
              icon={AlertTriangle}
              color="oklch(0.610 0.210 0)"
              colorBg="oklch(0.610 0.210 0 / 12%)"
              colorRing="oklch(0.610 0.210 0 / 25%)"
            />
          </div>
        </>
      )}

      {/* ── Owner Section: Customers + Destinations ────────────────── */}
      <SectionLabel icon={Users} label={t("sections.customersDestinations")} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              {t("charts.topCustomers", { period: periodLabel })}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {t("charts.totalTonsDelivered")}
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ChartSkeleton />
            ) : !owner?.topCustomers.length ? (
              <EmptyState label={t("empty.deliveries")} />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={owner.topCustomers}
                  layout="vertical"
                  margin={{ top: 4, right: 52, left: 0, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tickFormatter={formatTonsCompact}
                    tick={{
                      fontSize: 10,
                      fill: "hsl(var(--muted-foreground))",
                    }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={<TruncatedYTick maxChars={10} />}
                    tickLine={false}
                    axisLine={false}
                    width={90}
                  />
                  <Tooltip content={<TonsBarTooltip />} />
                  <Bar
                    dataKey="tons"
                    radius={[0, 6, 6, 0]}
                    maxBarSize={28}
                  >
                    {owner.topCustomers.map((_, i) => (
                      <Cell
                        key={i}
                        fill={TOP_BAR_COLORS[i % TOP_BAR_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              {t("charts.topDestinations", { period: periodLabel })}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {t("charts.totalTonsDelivered")}
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ChartSkeleton />
            ) : !owner?.topDestinations.length ? (
              <EmptyState label={t("empty.destinations")} />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={owner.topDestinations}
                  layout="vertical"
                  margin={{ top: 4, right: 52, left: 0, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tickFormatter={formatTonsCompact}
                    tick={{
                      fontSize: 10,
                      fill: "hsl(var(--muted-foreground))",
                    }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={<TruncatedYTick maxChars={10} />}
                    tickLine={false}
                    axisLine={false}
                    width={90}
                  />
                  <Tooltip content={<TonsBarTooltip />} />
                  <Bar
                    dataKey="tons"
                    radius={[0, 6, 6, 0]}
                    maxBarSize={28}
                  >
                    {owner.topDestinations.map((_, i) => (
                      <Cell
                        key={i}
                        fill={TOP_BAR_COLORS[(i + 2) % TOP_BAR_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Owner Section: Production breakdown ──────────────────────── */}
      <SectionLabel
        icon={Package}
        label={t("sections.productionMix", { period: periodLabel })}
      />

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            {t("charts.tonsByKind")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("charts.tonsByKindSub")}
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <ChartSkeleton />
          ) : !tonsByKindLocalized.length ? (
            <EmptyState label={t("empty.weighSessions")} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={tonsByKindLocalized}
                margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{
                    fontSize: 11,
                    fill: "hsl(var(--muted-foreground))",
                  }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={formatTonsCompact}
                  tick={{
                    fontSize: 10,
                    fill: "hsl(var(--muted-foreground))",
                  }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip content={<TonsBarTooltip />} />
                <Bar
                  dataKey="tons"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={56}
                >
                  {tonsByKindLocalized.map((entry) => (
                    <Cell
                      key={entry.kind}
                      fill={KIND_COLORS[entry.kind] ?? "#94a3b8"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── OPS Section: Fleet status + On scale ─────────────────────── */}
      {ops && (
        <>
          <SectionLabel icon={PieIcon} label={t("sections.fleetStatus")} />

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  {t("charts.fleetByStatus")}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {t("charts.fleetByStatusSub")}
                </p>
              </CardHeader>
              <CardContent className="flex flex-col items-center">
                {!fleetStatusLocalized.length ? (
                  <EmptyState label={t("empty.noTrucks")} />
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={fleetStatusLocalized}
                          cx="50%"
                          cy="50%"
                          innerRadius={56}
                          outerRadius={86}
                          paddingAngle={3}
                          dataKey="count"
                          nameKey="label"
                        >
                          {fleetStatusLocalized.map((entry) => (
                            <Cell
                              key={entry.status}
                              fill={entry.color}
                            />
                          ))}
                        </Pie>
                        <Tooltip content={<CountTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
                      {fleetStatusLocalized.map((s) => (
                        <div
                          key={s.status}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground"
                        >
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ background: s.color }}
                          />
                          {s.label}
                          <span className="font-semibold text-foreground">
                            {s.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  {t("charts.onScaleNow")}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {ops.onScale.length === 0
                    ? t("charts.onScaleEmpty")
                    : t("charts.onScaleCount", { count: ops.onScale.length })}
                </p>
              </CardHeader>
              <CardContent>
                {ops.onScale.length === 0 ? (
                  <div className="flex h-40 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                    {t("charts.scaleClear")}
                  </div>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                    {ops.onScale.map((truck) => (
                      <li
                        key={truck.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                      >
                        <div className="flex flex-col">
                          <span className="font-semibold tabular-nums">
                            {truck.plateNumber}
                          </span>
                          <span className="text-muted-foreground">
                            {truckStatusLabel(truck.status, tEnums)}
                          </span>
                        </div>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                          {formatMinutes(truck.minutesSince, t)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* ── OPS Section: Efficiency averages ─────────────────────────── */}
      {ops && (
        <>
          <SectionLabel icon={Timer} label={t("sections.efficiency")} />

          <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
            <KpiCard
              title={t("kpis.avgCycle")}
              value={formatMinutes(ops.averages30d.avgCycleMin, t)}
              sub={t("kpis.avgCycleSub")}
              icon={Timer}
              color="oklch(0.620 0.175 222)"
              colorBg="oklch(0.620 0.175 222 / 12%)"
              colorRing="oklch(0.620 0.175 222 / 25%)"
            />
            <KpiCard
              title={t("kpis.avgWaitBeforeTare")}
              value={formatMinutes(ops.averages30d.avgWaitBeforeTareMin, t)}
              sub={t("kpis.avgWaitBeforeTareSub")}
              icon={Timer}
              color="oklch(0.720 0.150 65)"
              colorBg="oklch(0.720 0.150 65 / 14%)"
              colorRing="oklch(0.720 0.150 65 / 28%)"
            />
            <KpiCard
              title={t("kpis.avgLoadingConfirm")}
              value={formatMinutes(ops.averages30d.avgLoadingMin, t)}
              sub={t("kpis.avgLoadingConfirmSub")}
              icon={Timer}
              color="oklch(0.650 0.190 290)"
              colorBg="oklch(0.650 0.190 290 / 12%)"
              colorRing="oklch(0.650 0.190 290 / 25%)"
            />
          </div>
        </>
      )}

      {/* ── OPS Section: Stuck trucks alert ──────────────────────────── */}
      {ops && (
        <>
          <SectionLabel icon={AlertTriangle} label={t("sections.stuckAlerts")} />

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                {t("charts.stuckTitle")}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {ops.stuckTrucks.length === 0
                  ? t("charts.stuckNone")
                  : t("charts.stuckCount", { count: ops.stuckTrucks.length })}
              </p>
            </CardHeader>
            <CardContent>
              {ops.stuckTrucks.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                  {t("charts.stuckAllClear")}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-[480px] w-full table-fixed text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="w-[28%] px-3 py-2 text-start font-semibold">
                          {t("table.plateNumber")}
                        </th>
                        <th className="w-[28%] px-3 py-2 text-start font-semibold">
                          {t("table.status")}
                        </th>
                        <th className="w-[22%] px-3 py-2 text-start font-semibold">
                          {t("table.since")}
                        </th>
                        <th className="w-[22%] px-3 py-2 text-start font-semibold">
                          {t("table.threshold")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {ops.stuckTrucks.map((truck) => (
                        <tr key={truck.id} className="bg-card">
                          <td className="px-3 py-2 text-start font-semibold tabular-nums">
                            {truck.plateNumber}
                          </td>
                          <td className="px-3 py-2 text-start text-muted-foreground">
                            {truckStatusLabel(truck.status, tEnums)}
                          </td>
                          <td className="px-3 py-2 text-start tabular-nums text-amber-600">
                            {formatMinutes(truck.minutesSince, t)}
                          </td>
                          <td className="px-3 py-2 text-start tabular-nums text-muted-foreground">
                            {formatMinutes(truck.thresholdMin, t)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

    </div>
  );
}
