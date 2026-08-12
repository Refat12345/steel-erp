"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  Package,
  Ruler,
  Signal,
  SignalZero,
  Boxes,
} from "lucide-react";
import { formatDateTime } from "@/lib/date-format";
import { formatInteger } from "@/lib/number-format";
import { cn } from "@/lib/utils";
import type { MillLiveSnapshot } from "@/lib/services/mill-live.service";

const REFRESH_MS = 20_000;

/** SCADA hourly registers: day 08:00–20:00, night 20:00–08:00. */
const DAY_SLOTS = Array.from({ length: 12 }, (_, i) => {
  const start = 8 + i;
  const end = start + 1;
  return { start, end };
});

const NIGHT_SLOTS = Array.from({ length: 12 }, (_, i) => {
  const start = (20 + i) % 24;
  const end = (21 + i) % 24;
  return { start, end };
});

function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

export function MillLiveBoard() {
  const t = useTranslations("millLive");
  const [data, setData] = useState<MillLiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mill-live/current", { cache: "no-store" });
      if (!res.ok) {
        setError(true);
        return;
      }
      const json = (await res.json()) as {
        success: boolean;
        data: MillLiveSnapshot | null;
      };
      if (!json.success) {
        setError(true);
        return;
      }
      setData(json.data);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const dayHours = data?.hourlyBreakdown.slice(0, 12) ?? [];
  const nightHours = data?.hourlyBreakdown.slice(12, 24) ?? [];
  const dayTotal = dayHours.reduce((a, b) => a + b, 0);
  const nightTotal = nightHours.reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 min-w-0">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t("eyebrow")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <StatusPill
          loading={loading}
          error={error}
          isLive={data?.isLive ?? false}
          lastAt={data?.createdAt}
          t={t}
        />
      </header>

      {loading && !data ? (
        <div className="rounded-2xl border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          {t("loading")}
        </div>
      ) : error && !data ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-16 text-center text-sm text-destructive">
          {t("loadError")}
        </div>
      ) : !data ? (
        <div className="rounded-2xl border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              icon={Ruler}
              label={t("productSize")}
              value={`${formatInteger(data.productSize)} ${t("mm")}`}
              accent="amber"
            />
            <Kpi
              icon={Package}
              label={t("totalBillets")}
              value={formatInteger(data.totalBillets)}
              accent="emerald"
              large
            />
            <Kpi
              icon={Boxes}
              label={t("frontPack")}
              value={formatInteger(data.frontPackCount)}
              accent="sky"
            />
            <Kpi
              icon={Boxes}
              label={t("backPack")}
              value={formatInteger(data.backPackCount)}
              accent="violet"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ShiftCard
              title={t("dayShift")}
              totalLabel={t("shiftTotal")}
              total={dayTotal}
              slots={DAY_SLOTS}
              counts={dayHours}
              hourRangeLabel={t}
            />
            <ShiftCard
              title={t("nightShift")}
              totalLabel={t("shiftTotal")}
              total={nightTotal}
              slots={NIGHT_SLOTS}
              counts={nightHours}
              hourRangeLabel={t}
            />
          </div>
        </>
      )}
    </div>
  );
}

function StatusPill({
  loading,
  error,
  isLive,
  lastAt,
  t,
}: {
  loading: boolean;
  error: boolean;
  isLive: boolean;
  lastAt?: string;
  t: ReturnType<typeof useTranslations<"millLive">>;
}) {
  let label = t("statusDelayed");
  let tone = "bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/30";
  let Icon = SignalZero;

  if (loading && !lastAt) {
    label = t("loading");
    tone = "bg-muted text-muted-foreground border-border";
    Icon = Activity;
  } else if (error && !lastAt) {
    label = t("statusError");
    tone = "bg-destructive/10 text-destructive border-destructive/30";
    Icon = SignalZero;
  } else if (isLive) {
    label = t("statusLive");
    tone = "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border-emerald-500/30";
    Icon = Signal;
  }

  return (
    <div
      className={cn(
        "inline-flex flex-col items-start gap-1 rounded-xl border px-3 py-2 text-xs sm:items-end",
        tone,
      )}
    >
      <span className="inline-flex items-center gap-1.5 font-semibold tracking-wide">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      {lastAt ? (
        <span className="text-[11px] opacity-80">
          {t("lastUpdate", { time: formatDateTime(lastAt) })}
        </span>
      ) : null}
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  accent,
  large,
}: {
  icon: typeof Package;
  label: string;
  value: string;
  accent: "amber" | "emerald" | "sky" | "violet";
  large?: boolean;
}) {
  const gradients = {
    amber: "from-amber-500/20 to-transparent",
    emerald: "from-emerald-500/20 to-transparent",
    sky: "from-sky-500/20 to-transparent",
    violet: "from-violet-500/20 to-transparent",
  } as const;
  const iconTone = {
    amber: "text-amber-700 dark:text-amber-300",
    emerald: "text-emerald-700 dark:text-emerald-300",
    sky: "text-sky-700 dark:text-sky-300",
    violet: "text-violet-700 dark:text-violet-300",
  } as const;

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-4 shadow-sm">
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-80",
          gradients[accent],
        )}
      />
      <div className="relative flex flex-col gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className={cn("h-4 w-4", iconTone[accent])} />
          <span className="text-xs font-medium">{label}</span>
        </div>
        <p
          className={cn(
            "font-semibold tracking-tight weight-value",
            large ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl",
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

function ShiftCard({
  title,
  totalLabel,
  total,
  slots,
  counts,
  hourRangeLabel,
}: {
  title: string;
  totalLabel: string;
  total: number;
  slots: Array<{ start: number; end: number }>;
  counts: number[];
  hourRangeLabel: ReturnType<typeof useTranslations<"millLive">>;
}) {
  return (
    <section className="rounded-2xl border bg-card shadow-sm min-w-0">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">
          {totalLabel}:{" "}
          <span className="font-semibold text-foreground weight-value">
            {formatInteger(total)}
          </span>
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[280px] text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="px-4 py-2 text-start font-medium">
                {hourRangeLabel("hour")}
              </th>
              <th className="px-4 py-2 text-end font-medium">
                {hourRangeLabel("count")}
              </th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, idx) => {
              const count = counts[idx] ?? 0;
              return (
                <tr key={`${slot.start}-${slot.end}`} className="border-b last:border-0">
                  <td className="px-4 py-2 text-start tabular-nums weight-value">
                    {hourRangeLabel("hourRange", {
                      start: hourLabel(slot.start),
                      end: hourLabel(slot.end),
                    })}
                  </td>
                  <td className="px-4 py-2 text-end font-medium tabular-nums weight-value">
                    {formatInteger(count)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
