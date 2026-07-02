"use client";

/**
 * ─── ARCHIVED — Sales / Finance Dashboard ─────────────────────────────
 *
 * This component renders the original KPI dashboard built around sales
 * orders, contracts, payments, and top customers by paid amount.
 *
 * It is intentionally NOT imported anywhere in v1: the production
 * rollout starts with the Trucks + Scale modules only, so the live
 * dashboard at `/` uses `charts-section.operations.tsx` instead.
 *
 * To re-enable this view when the finance & sales modules go live,
 * swap the import in `src/app/(dashboard)/page.tsx`:
 *   `import { ChartsSection } from "@/components/dashboard/charts-section.sales"`
 *
 * Keep the file in sync with `/api/dashboard/stats` if its response
 * shape ever changes — the matching service is `src/lib/dashboard-stats.ts`.
 * ─────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TrendingUp,
  Users,
  FileText,
  ShoppingCart,
  Banknote,
  BarChart2,
  PieChart as PieIcon,
  Activity,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DashboardStats {
  kpis: {
    totalPaymentsAmount: number;
    activeOrders: number;
    activeContracts: number;
    totalCustomers: number;
  };
  ordersByStatus: { status: string; label: string; count: number; color: string }[];
  ordersByKind: { kind: string; label: string; count: number }[];
  totalTonsByKind: { kind: string; label: string; tons: number }[];
  contractsByStatus: { status: string; label: string; count: number }[];
  paymentsTimeline: { date: string; label: string; total: number }[];
  topCustomers: { customerId: number; name: string; code: string; total: number }[];
  paymentsByMethod: { method: string; label: string; total: number; count: number }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compact form for axes where space is tight: $406K, $1.5M */
function formatAmount(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(v);
}

/** Full form for tooltips and detail rows: 406,000 $ */
function formatCurrency(v: number) {
  return (
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(v) + " $"
  );
}

/** Custom Y-axis tick that truncates long Arabic text to avoid overflow into bars */
function TruncatedYTick({
  x, y, payload, maxChars = 10,
}: {
  x?: number; y?: number;
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

const METHOD_COLORS: Record<string, string> = {
  CASH: "#10b981",
  BANK_TRANSFER: "#3b82f6",
  CHECK: "#f59e0b",
};

// ── Custom Tooltip ─────────────────────────────────────────────────────────────

function AmountTooltip({ active, payload, label }: { active?: boolean; payload?: {value: number}[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      <p className="text-muted-foreground">
        <span className="font-bold text-primary">{formatCurrency(payload[0].value)}</span>
      </p>
    </div>
  );
}

function CountTooltip({ active, payload, label }: { active?: boolean; payload?: {value: number}[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      <p className="text-muted-foreground">
        <span className="font-bold text-primary">{payload[0].value}</span> أمر
      </p>
    </div>
  );
}

function TonsTooltip({ active, payload, label }: { active?: boolean; payload?: {value: number}[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      <p className="text-muted-foreground">
        <span className="font-bold text-primary">{formatCurrency(payload[0].value)}</span> طن
      </p>
    </div>
  );
}

function PieTooltip({ active, payload }: { active?: boolean; payload?: {name: string; value: number}[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs">
      <p className="font-semibold text-foreground">{payload[0].name}</p>
      <p className="text-muted-foreground">
        <span className="font-bold text-primary">{payload[0].value}</span> أمر
      </p>
    </div>
  );
}

// ── Section Header ─────────────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
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

// ── KPI Card ───────────────────────────────────────────────────────────────────

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
      <div className="h-[3px] w-full shrink-0 transition-all duration-300 group-hover:h-1" style={{ background: color }} />
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2 pt-5">
        <CardTitle className="text-sm font-medium leading-snug text-muted-foreground">{title}</CardTitle>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110"
          style={{ background: colorBg, boxShadow: `inset 0 0 0 1px ${colorRing}` }}
        >
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
      </CardHeader>
      <CardContent className="pb-5">
        <div className="financial-value text-3xl font-bold tracking-tight" style={{ color }}>
          {value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function ChartSkeleton({ h = 260 }: { h?: number }) {
  return (
    <div className="animate-pulse rounded-lg bg-muted" style={{ height: h }} />
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ChartsSection() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((j) => { if (j.success) setStats(j.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ── KPI values ──────────────────────────────────────────────────────────────
  const kpis = stats?.kpis;
  const kpiCards = [
    {
      title: "إجمالي الدفعات المحصّلة",
      value: kpis ? formatAmount(kpis.totalPaymentsAmount) : "—",
      sub: kpis ? `${formatCurrency(kpis.totalPaymentsAmount)} — كامل الفترة` : "كامل الفترة",
      icon: Banknote,
      color: "oklch(0.390 0.130 232)",
      colorBg: "oklch(0.390 0.130 232 / 12%)",
      colorRing: "oklch(0.390 0.130 232 / 25%)",
    },
    {
      title: "أوامر البيع النشطة",
      value: kpis ? String(kpis.activeOrders) : "—",
      sub: "معتمدة + قيد التنفيذ",
      icon: ShoppingCart,
      color: "oklch(0.720 0.150 65)",
      colorBg: "oklch(0.720 0.150 65 / 14%)",
      colorRing: "oklch(0.720 0.150 65 / 28%)",
    },
    {
      title: "العقود النشطة",
      value: kpis ? String(kpis.activeContracts) : "—",
      sub: "عقود سارية المفعول",
      icon: FileText,
      color: "oklch(0.630 0.155 152)",
      colorBg: "oklch(0.630 0.155 152 / 12%)",
      colorRing: "oklch(0.630 0.155 152 / 25%)",
    },
    {
      title: "إجمالي العملاء",
      value: kpis ? String(kpis.totalCustomers) : "—",
      sub: "عملاء نشطون في النظام",
      icon: Users,
      color: "oklch(0.610 0.210 0)",
      colorBg: "oklch(0.610 0.210 0 / 12%)",
      colorRing: "oklch(0.610 0.210 0 / 25%)",
    },
  ];

  return (
    <div className="space-y-10">
      {/* ── KPI Cards ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((card) => (
          <div key={card.title} className="animate-in fade-in-0 slide-in-from-bottom-4 duration-500">
            <KpiCard {...card} />
          </div>
        ))}
      </div>

      {/* ── Chart Row 1: Payments Timeline + Orders by Status ─────────── */}
      <SectionLabel icon={Activity} label="الدفعات وأوامر البيع" />

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Payments area chart — wider */}
        <Card className="col-span-3 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">الدفعات المحصّلة — آخر 30 يوم</CardTitle>
            <p className="text-xs text-muted-foreground">المبلغ اليومي بالدولار</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ChartSkeleton />
            ) : !stats?.paymentsTimeline.length ? (
              <div className="flex h-52 items-center justify-center text-xs text-muted-foreground">لا توجد دفعات في آخر 30 يوم</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={stats.paymentsTimeline} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="payGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={formatAmount} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip content={<AmountTooltip />} />
                  <Area type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} fill="url(#payGrad)" dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Orders by status donut — narrower */}
        <Card className="col-span-2 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">أوامر البيع حسب الحالة</CardTitle>
            <p className="text-xs text-muted-foreground">توزيع جميع الأوامر</p>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            {loading ? (
              <ChartSkeleton h={220} />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={stats?.ordersByStatus ?? []}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={78}
                      paddingAngle={3}
                      dataKey="count"
                      nameKey="label"
                    >
                      {(stats?.ordersByStatus ?? []).map((entry) => (
                        <Cell key={entry.status} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
                  {(stats?.ordersByStatus ?? []).map((s) => (
                    <div key={s.status} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
                      {s.label}
                      <span className="font-semibold text-foreground">{s.count}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Chart Row 2: Tons by Kind + Top Customers ─────────────────── */}
      <SectionLabel icon={BarChart2} label="البضاعة والعملاء" />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Total tons by kind */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">الكميات المتعاقد عليها بالطن</CardTitle>
            <p className="text-xs text-muted-foreground">أوامر معتمدة + قيد التنفيذ + مكتملة</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ChartSkeleton />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={stats?.totalTonsByKind ?? []}
                  layout="vertical"
                  margin={{ top: 4, right: 52, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tickFormatter={formatAmount} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="label" tick={<TruncatedYTick maxChars={9} />} tickLine={false} axisLine={false} width={80} />
                  <Tooltip content={<TonsTooltip />} />
                  <Bar dataKey="tons" radius={[0, 6, 6, 0]} maxBarSize={28}>
                    {(stats?.totalTonsByKind ?? []).map((entry) => (
                      <Cell key={entry.kind} fill={KIND_COLORS[entry.kind] ?? "#94a3b8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Top 5 customers by payment */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">أكبر 5 عملاء دفعاً</CardTitle>
            <p className="text-xs text-muted-foreground">إجمالي الدفعات المحصّلة بالدولار</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ChartSkeleton />
            ) : !stats?.topCustomers.length ? (
              <div className="flex h-52 items-center justify-center text-xs text-muted-foreground">لا توجد بيانات دفعات</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={stats.topCustomers}
                  layout="vertical"
                  margin={{ top: 4, right: 52, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tickFormatter={formatAmount} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={<TruncatedYTick maxChars={9} />} tickLine={false} axisLine={false} width={80} />
                  <Tooltip content={<AmountTooltip />} />
                  <Bar dataKey="total" radius={[0, 6, 6, 0]} maxBarSize={28}>
                    {stats.topCustomers.map((_, i) => (
                      <Cell
                        key={i}
                        fill={["#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#ec4899"][i % 5]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Chart Row 3: Orders by Kind + Payment Methods ─────────────── */}
      <SectionLabel icon={PieIcon} label="توزيع الأنواع وطرق الدفع" />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Orders count by kind */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">عدد أوامر البيع حسب النوع</CardTitle>
            <p className="text-xs text-muted-foreground">جميع الأوامر في النظام</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ChartSkeleton h={200} />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={stats?.ordersByKind ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={28} />
                  <Tooltip content={<CountTooltip />} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={48}>
                    {(stats?.ordersByKind ?? []).map((entry) => (
                      <Cell key={entry.kind} fill={KIND_COLORS[entry.kind] ?? "#94a3b8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Payment method breakdown */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">الدفعات حسب طريقة السداد</CardTitle>
            <p className="text-xs text-muted-foreground">إجمالي المبالغ بالدولار</p>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            {loading ? (
              <ChartSkeleton h={220} />
            ) : !stats?.paymentsByMethod.length ? (
              <div className="flex h-52 items-center justify-center text-xs text-muted-foreground">لا توجد دفعات</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie
                      data={stats.paymentsByMethod}
                      cx="50%"
                      cy="50%"
                      outerRadius={72}
                      paddingAngle={3}
                      dataKey="total"
                      nameKey="label"
                    >
                      {stats.paymentsByMethod.map((entry) => (
                        <Cell key={entry.method} fill={METHOD_COLORS[entry.method] ?? "#94a3b8"} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => [`${formatCurrency(Number(v))} $`, ""]}
                      labelFormatter={(l) => l}
                    />
                    <Legend
                      formatter={(value) => <span className="text-xs">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 w-full divide-y divide-border rounded-lg border border-border overflow-hidden">
                  {stats.paymentsByMethod.map((m) => (
                    <div key={m.method} className="flex items-center justify-between px-3 py-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: METHOD_COLORS[m.method] ?? "#94a3b8" }} />
                        <span className="text-muted-foreground">{m.label}</span>
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{m.count} دفعة</span>
                      </div>
                      <span className="font-semibold tabular-nums">{formatCurrency(m.total)} $</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
