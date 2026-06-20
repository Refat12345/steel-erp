"use client";

/**
 * ─── Operations KPI Dashboard ─────────────────────────────────────────
 *
 * Live dashboard for the v1 roll-out (Trucks + Scale modules only).
 * Renders two tiers of content composed by `/api/dashboard/operations-stats`:
 *
 *   • OWNER tier — always rendered. Shows completed-truck KPIs for the
 *     selected period (today / week / month), 14-day activity, top
 *     customers, top destinations, kind mix, grade mix.
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

import { useEffect, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  MapPin,
  Package,
  PieChart as PieIcon,
  Timer,
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

interface OwnerStats {
  period: Period;
  kpis: {
    completedTrucks: number;
    totalTons: number;
    servedCustomers: number;
    servedDestinations: number;
  };
  activity14d: { date: string; label: string; trucks: number; tons: number }[];
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

function formatTons(v: number): string {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v)} طن`;
}

function formatTonsCompact(v: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(v);
}

function formatMinutes(min: number | null): string {
  if (min === null || min === undefined) return "—";
  if (min < 60) return `${min} د`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return `${h} س`;
  return `${h} س ${m} د`;
}

const PERIOD_LABEL: Record<Period, string> = {
  today: "اليوم",
  week: "هذا الأسبوع",
  month: "هذا الشهر",
};

const KIND_COLORS: Record<string, string> = {
  REBAR: "#3b82f6",
  SHORTBAR_1_4M: "#8b5cf6",
  SHORTBAR_4_12M: "#a855f7",
  SCRAP: "#f97316",
  BILLET_WIRE: "#14b8a6",
};

const GRADE_COLORS: Record<string, string> = {
  FIRST: "#10b981",
  SECOND: "#f59e0b",
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

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  color,
  colorBg,
  colorRing,
}: {
  title: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  color: string;
  colorBg: string;
  colorRing: string;
}) {
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
          className="financial-value text-3xl font-bold tracking-tight"
          style={{ color }}
        >
          {value}
        </div>
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
  const options: Period[] = ["today", "week", "month"];
  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-card p-1 shadow-sm">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
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
          >
            {PERIOD_LABEL[opt]}
          </button>
        );
      })}
    </div>
  );
}

// ─── Tooltips ──────────────────────────────────────────────────────────

function TonsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="text-muted-foreground">
          <span
            className="inline-block h-2 w-2 rounded-full me-1.5 align-middle"
            style={{ background: p.color }}
          />
          <span className="font-bold text-primary">
            {p.name === "trucks"
              ? `${p.value} شاحنة`
              : formatTons(p.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

function CountTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { value: number; name: string }[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs">
      <p className="font-semibold text-foreground">{payload[0].name}</p>
      <p className="text-muted-foreground">
        <span className="font-bold text-primary">{payload[0].value}</span>{" "}
        شاحنة
      </p>
    </div>
  );
}

function PieTonsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name: string; value: number }[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs">
      <p className="font-semibold text-foreground">{payload[0].name}</p>
      <p className="text-muted-foreground">
        <span className="font-bold text-primary">
          {formatTons(payload[0].value)}
        </span>
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
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      <p className="text-muted-foreground">
        <span className="font-bold text-primary">
          {formatTons(payload[0].value)}
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
  const [period, setPeriod] = useState<Period>("today");
  const [data, setData] = useState<ApiResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Period changes flow through this event handler so the loading/error
  // resets happen synchronously with the user gesture — not inside the
  // effect body, which would trigger react-hooks/set-state-in-effect.
  function handlePeriodChange(next: Period) {
    if (next === period) return;
    setLoading(true);
    setError(null);
    setPeriod(next);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dashboard/operations-stats?period=${period}`)
      .then((r) => r.json())
      .then((j: ApiResponse) => {
        if (cancelled) return;
        if (!j.success) {
          setError("تعذّر تحميل المؤشرات");
          return;
        }
        setData(j.data);
      })
      .catch(() => {
        if (!cancelled) setError("تعذّر الاتصال بالخادم");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const owner = data?.owner;
  const ops = data?.ops;

  // ── Owner KPI cards (4) ──────────────────────────────────────────────
  const ownerKpis = [
    {
      title: `شاحنات مكتملة (${PERIOD_LABEL[period]})`,
      value: owner ? String(owner.kpis.completedTrucks) : "—",
      sub: "العمليات المغلقة بالكامل",
      icon: Truck,
      color: "oklch(0.390 0.130 232)",
      colorBg: "oklch(0.390 0.130 232 / 12%)",
      colorRing: "oklch(0.390 0.130 232 / 25%)",
    },
    {
      title: `إجمالي الأطنان (${PERIOD_LABEL[period]})`,
      value: owner ? formatTonsCompact(owner.kpis.totalTons) : "—",
      sub: owner ? `${formatTons(owner.kpis.totalTons)} مسلَّمة` : "—",
      icon: Weight,
      color: "oklch(0.630 0.155 152)",
      colorBg: "oklch(0.630 0.155 152 / 12%)",
      colorRing: "oklch(0.630 0.155 152 / 25%)",
    },
    {
      title: "الزبائن المخدومون",
      value: owner ? String(owner.kpis.servedCustomers) : "—",
      sub: `خلال ${PERIOD_LABEL[period]}`,
      icon: Users,
      color: "oklch(0.720 0.150 65)",
      colorBg: "oklch(0.720 0.150 65 / 14%)",
      colorRing: "oklch(0.720 0.150 65 / 28%)",
    },
    {
      title: "الوجهات المخدومة",
      value: owner ? String(owner.kpis.servedDestinations) : "—",
      sub: `خلال ${PERIOD_LABEL[period]}`,
      icon: MapPin,
      color: "oklch(0.610 0.210 0)",
      colorBg: "oklch(0.610 0.210 0 / 12%)",
      colorRing: "oklch(0.610 0.210 0 / 25%)",
    },
  ];

  return (
    <div className="space-y-10">
      {/* ── Header: period toggle ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          الفترة المعروضة في بطاقات الإنجاز حسب يوم التشغيل 08:00 → 08:00
        </p>
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
            <KpiCard {...card} />
          </div>
        ))}
      </div>

      {/* ── OPS KPIs (only if `ops` present) ──────────────────────── */}
      {ops && (
        <>
          <SectionLabel icon={Gauge} label="حالة العمليات الآن" />
          <div className="grid gap-4 grid-cols-2 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="قيد التنفيذ الآن"
              value={String(ops.kpis.activeNow)}
              sub="شاحنات بين الطابور والوزن الثاني"
              icon={Activity}
              color="oklch(0.620 0.175 222)"
              colorBg="oklch(0.620 0.175 222 / 12%)"
              colorRing="oklch(0.620 0.175 222 / 25%)"
            />
            <KpiCard
              title="على الميزان الآن"
              value={String(ops.kpis.onScaleNow)}
              sub="بانتظار اكتمال التحميل"
              icon={Weight}
              color="oklch(0.650 0.190 290)"
              colorBg="oklch(0.650 0.190 290 / 12%)"
              colorRing="oklch(0.650 0.190 290 / 25%)"
            />
            <KpiCard
              title="شاحنات عالقة"
              value={String(ops.kpis.stuckNow)}
              sub="تجاوزت العتبة الزمنية لحالتها"
              icon={AlertTriangle}
              color="oklch(0.700 0.180 50)"
              colorBg="oklch(0.700 0.180 50 / 12%)"
              colorRing="oklch(0.700 0.180 50 / 25%)"
            />
            <KpiCard
              title="نسبة الإلغاء (30 يوم)"
              value={
                ops.kpis.cancellationPct30d === null
                  ? "—"
                  : `${ops.kpis.cancellationPct30d}٪`
              }
              sub="من إجمالي العمليات المنتهية"
              icon={AlertTriangle}
              color="oklch(0.610 0.210 0)"
              colorBg="oklch(0.610 0.210 0 / 12%)"
              colorRing="oklch(0.610 0.210 0 / 25%)"
            />
          </div>
        </>
      )}

      {/* ── Owner Section: 14-day activity ────────────────────────────── */}
      <SectionLabel icon={Activity} label="نشاط آخر 14 يوم" />

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            الشاحنات المكتملة والأطنان المسلَّمة
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            خط الشاحنات (عدد) ومنطقة الأطنان — آخر 14 يوماً
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <ChartSkeleton />
          ) : !owner?.activity14d.length ? (
            <EmptyState label="لا يوجد نشاط في آخر 14 يوم" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart
                data={owner.activity14d}
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="tonsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{
                    fontSize: 10,
                    fill: "hsl(var(--muted-foreground))",
                  }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  yAxisId="left"
                  tick={{
                    fontSize: 10,
                    fill: "hsl(var(--muted-foreground))",
                  }}
                  tickLine={false}
                  axisLine={false}
                  width={28}
                  allowDecimals={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={formatTonsCompact}
                  tick={{
                    fontSize: 10,
                    fill: "hsl(var(--muted-foreground))",
                  }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip content={<TonsTooltip />} />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="tons"
                  name="tons"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#tonsGrad)"
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="trucks"
                  name="trucks"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Owner Section: Customers + Destinations ────────────────── */}
      <SectionLabel icon={Users} label="الزبائن والوجهات" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              أكبر 5 زبائن (آخر 30 يوم)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              إجمالي الأطنان المسلَّمة
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ChartSkeleton />
            ) : !owner?.topCustomers.length ? (
              <EmptyState label="لا توجد بيانات تسليم" />
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
              أكبر 5 وجهات (آخر 30 يوم)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              إجمالي الأطنان المسلَّمة
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ChartSkeleton />
            ) : !owner?.topDestinations.length ? (
              <EmptyState label="لا توجد بيانات وجهات" />
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
      <SectionLabel icon={Package} label="توزيع الإنتاج (آخر 30 يوم)" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              الأطنان حسب نوع المادة
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              مجموع وزن الجلسات حسب القياس
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ChartSkeleton />
            ) : !owner?.tonsByKind.length ? (
              <EmptyState label="لا توجد جلسات وزن" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={owner.tonsByKind}
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
                    {owner.tonsByKind.map((entry) => (
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

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              توزيع الجودة
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              نسبة الأطنان حسب الدرجة في{" "}
              {PERIOD_LABEL[period]}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            {loading ? (
              <ChartSkeleton h={220} />
            ) : !owner?.tonsByGrade.length ? (
              <EmptyState label="لا توجد بيانات درجة" />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={owner.tonsByGrade}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={78}
                      paddingAngle={3}
                      dataKey="tons"
                      nameKey="label"
                    >
                      {owner.tonsByGrade.map((entry) => (
                        <Cell
                          key={entry.grade}
                          fill={GRADE_COLORS[entry.grade] ?? "#94a3b8"}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTonsTooltip />} />
                    <Legend
                      formatter={(value) => (
                        <span className="text-xs">{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── OPS Section: Fleet status + On scale ─────────────────────── */}
      {ops && (
        <>
          <SectionLabel icon={PieIcon} label="حالة الأسطول" />

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  توزيع الشاحنات حسب الحالة
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  لقطة حالية لكامل الأسطول
                </p>
              </CardHeader>
              <CardContent className="flex flex-col items-center">
                {!ops.fleetStatus.length ? (
                  <EmptyState label="لا توجد شاحنات مسجَّلة بعد" />
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={ops.fleetStatus}
                          cx="50%"
                          cy="50%"
                          innerRadius={56}
                          outerRadius={86}
                          paddingAngle={3}
                          dataKey="count"
                          nameKey="label"
                        >
                          {ops.fleetStatus.map((entry) => (
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
                      {ops.fleetStatus.map((s) => (
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
                  على الميزان الآن
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {ops.onScale.length === 0
                    ? "لا توجد شاحنات على الميزان"
                    : `${ops.onScale.length} شاحنة`}
                </p>
              </CardHeader>
              <CardContent>
                {ops.onScale.length === 0 ? (
                  <div className="flex h-40 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                    الميزان فارغ
                  </div>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                    {ops.onScale.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                      >
                        <div className="flex flex-col">
                          <span className="font-semibold tabular-nums">
                            {t.plateNumber}
                          </span>
                          <span className="text-muted-foreground">
                            {t.statusLabel}
                          </span>
                        </div>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                          {formatMinutes(t.minutesSince)}
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
          <SectionLabel icon={Timer} label="مؤشرات الكفاءة (30 يوم)" />

          <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
            <KpiCard
              title="متوسط زمن الدورة"
              value={formatMinutes(ops.averages30d.avgCycleMin)}
              sub="من التسجيل حتى الإغلاق"
              icon={Timer}
              color="oklch(0.620 0.175 222)"
              colorBg="oklch(0.620 0.175 222 / 12%)"
              colorRing="oklch(0.620 0.175 222 / 25%)"
            />
            <KpiCard
              title="الانتظار قبل الفارغ"
              value={formatMinutes(ops.averages30d.avgWaitBeforeTareMin)}
              sub="من التسجيل حتى وزن الفارغ"
              icon={Timer}
              color="oklch(0.720 0.150 65)"
              colorBg="oklch(0.720 0.150 65 / 14%)"
              colorRing="oklch(0.720 0.150 65 / 28%)"
            />
            <KpiCard
              title="متوسط زمن تأكيد التحميل"
              value={formatMinutes(ops.averages30d.avgLoadingMin)}
              sub="من الوزن الفارغ حتى تأكيد المحمّل — 30 يوم"
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
          <SectionLabel icon={AlertTriangle} label="تنبيهات الشاحنات العالقة" />

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                شاحنات تجاوزت العتبة الزمنية لحالتها
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {ops.stuckTrucks.length === 0
                  ? "لا توجد شاحنات عالقة الآن"
                  : `${ops.stuckTrucks.length} شاحنة بحاجة لمتابعة`}
              </p>
            </CardHeader>
            <CardContent>
              {ops.stuckTrucks.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                  جميع العمليات تسير ضمن العتبات المسموحة
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-[480px] w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr className="text-right">
                        <th className="px-3 py-2 font-semibold">رقم اللوحة</th>
                        <th className="px-3 py-2 font-semibold">الحالة</th>
                        <th className="px-3 py-2 font-semibold">منذ</th>
                        <th className="px-3 py-2 font-semibold">العتبة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {ops.stuckTrucks.map((t) => (
                        <tr key={t.id} className="bg-card">
                          <td className="px-3 py-2 font-semibold tabular-nums">
                            {t.plateNumber}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {t.statusLabel}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-amber-600">
                            {formatMinutes(t.minutesSince)}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">
                            {formatMinutes(t.thresholdMin)}
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
