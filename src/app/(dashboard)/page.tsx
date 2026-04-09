import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FileText,
  ShoppingCart,
  Truck,
  Scale,
  Factory,
  CalendarDays,
  Clock,
  LayoutDashboard,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface StatCardConfig {
  title: string;
  icon: LucideIcon;
  color: string;
  colorBg: string;
  colorRing: string;
  slice: string;
  delay: string;
}

const statCards: StatCardConfig[] = [
  {
    title: "العقود النشطة",
    icon: FileText,
    color: "oklch(0.390 0.130 232)",
    colorBg: "oklch(0.390 0.130 232 / 12%)",
    colorRing: "oklch(0.390 0.130 232 / 25%)",
    slice: "الشريحة 1",
    delay: "delay-100",
  },
  {
    title: "أوامر البيع قيد التنفيذ",
    icon: ShoppingCart,
    color: "oklch(0.720 0.150 65)",
    colorBg: "oklch(0.720 0.150 65 / 14%)",
    colorRing: "oklch(0.720 0.150 65 / 28%)",
    slice: "الشريحة 2",
    delay: "delay-200",
  },
  {
    title: "شاحنات في الطابور",
    icon: Truck,
    color: "oklch(0.630 0.155 152)",
    colorBg: "oklch(0.630 0.155 152 / 12%)",
    colorRing: "oklch(0.630 0.155 152 / 25%)",
    slice: "الشريحة 3",
    delay: "delay-300",
  },
  {
    title: "وزنات اليوم",
    icon: Scale,
    color: "oklch(0.610 0.210 0)",
    colorBg: "oklch(0.610 0.210 0 / 12%)",
    colorRing: "oklch(0.610 0.210 0 / 25%)",
    slice: "الشريحة 5",
    delay: "delay-500",
  },
];

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  const dateStr = new Date().toLocaleDateString("ar-SA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-8">

      {/* ── Greeting Banner ─────────────────────────────────────────── */}
      <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
            style={{
              background: "oklch(0.390 0.130 232 / 12%)",
              boxShadow: "inset 0 0 0 1px oklch(0.390 0.130 232 / 22%)",
            }}
          >
            <Factory
              className="h-6 w-6"
              style={{ color: "oklch(0.390 0.130 232)" }}
            />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">
              أهلاً،{" "}
              <span style={{ color: "oklch(0.390 0.130 232)" }}>
                {session?.user.name}
              </span>
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              مرحباً بك في نظام إدارة مصنع الحديد
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold"
            style={{
              background: "oklch(0.390 0.130 232 / 10%)",
              color: "oklch(0.390 0.130 232)",
              boxShadow: "inset 0 0 0 1px oklch(0.390 0.130 232 / 22%)",
            }}
          >
            {session?.user.roleName}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            {dateStr}
          </span>
        </div>
      </div>

      {/* ── Section Label ────────────────────────────────────────────── */}
      <div className="animate-in fade-in-0 duration-500 delay-75 flex items-center gap-3">
        <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          نظرة عامة
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* ── Stat Cards ───────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.title}
              className={`animate-in fade-in-0 slide-in-from-bottom-4 duration-500 ${card.delay}`}
            >
              <Card className="group gap-0 overflow-hidden pt-0 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                {/* Top accent bar */}
                <div
                  className="h-[3px] w-full shrink-0 transition-all duration-300 group-hover:h-1"
                  style={{ background: card.color }}
                />

                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2 pt-5">
                  <CardTitle className="text-sm font-medium leading-snug text-muted-foreground">
                    {card.title}
                  </CardTitle>

                  {/* Icon bubble */}
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110"
                    style={{
                      background: card.colorBg,
                      boxShadow: `inset 0 0 0 1px ${card.colorRing}`,
                    }}
                  >
                    <Icon
                      className="h-4 w-4"
                      style={{ color: card.color }}
                    />
                  </div>
                </CardHeader>

                <CardContent className="pb-5">
                  {/* Metric value */}
                  <div
                    className="financial-value text-3xl font-bold tracking-tight"
                    style={{ color: card.color }}
                  >
                    —
                  </div>

                  {/* Coming soon pill */}
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-200 group-hover:border-current group-hover:bg-transparent"
                    style={
                      { "--hover-color": card.color } as React.CSSProperties
                    }
                  >
                    <Clock className="h-3 w-3 shrink-0" />
                    <span>قريباً</span>
                    <span className="mx-0.5 opacity-40">·</span>
                    <span>{card.slice}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
