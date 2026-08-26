"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/date-format";
import { formatInteger } from "@/lib/number-format";
import { cn } from "@/lib/utils";
import { getTextDirection, type Locale } from "@/i18n/config";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MillLiveCurrentResponse } from "@/lib/services/mill-live.service";

const REFRESH_MS = 20_000;

/** SCADA hourly registers: day 08:00–20:00, night 20:00–08:00. */
const DAY_SLOTS = Array.from({ length: 12 }, (_, i) => {
  const start = 8 + i;
  return { start, end: start + 1 };
});

const NIGHT_SLOTS = Array.from({ length: 12 }, (_, i) => {
  const start = (20 + i) % 24;
  return { start, end: (21 + i) % 24 };
});

function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function currentClockHour(): number {
  return new Date().getHours();
}

export function MillLiveBoard() {
  const t = useTranslations("millLive");
  const tBrand = useTranslations("brand");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const [data, setData] = useState<MillLiveCurrentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [savingSize, setSavingSize] = useState(false);
  const [clockHour, setClockHour] = useState(currentClockHour);
  const [now, setNow] = useState(() => new Date());
  const savingSizeRef = useRef(false);

  const load = useCallback(async () => {
    if (savingSizeRef.current) return;
    try {
      const res = await fetch("/api/mill-live/current", { cache: "no-store" });
      if (!res.ok) {
        setError(true);
        return;
      }
      const json = (await res.json()) as {
        success: boolean;
        data: MillLiveCurrentResponse;
      };
      if (!json.success || !json.data) {
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

  useEffect(() => {
    const id = window.setInterval(() => {
      setClockHour(currentClockHour());
      setNow(new Date());
    }, 1_000);
    return () => window.clearInterval(id);
  }, []);

  const sizeItems = useMemo(
    () =>
      (data?.sizes ?? []).map((s) => ({
        value: String(s.id),
        label: s.displayName,
      })),
    [data?.sizes],
  );

  async function persistProductSize(sizeId: number) {
    if (!data || sizeId === data.productSizeId) return;
    const previous = data;
    const label =
      data.sizes.find((s) => s.id === sizeId)?.displayName ?? data.productSizeLabel;
    savingSizeRef.current = true;
    setSavingSize(true);
    setData({ ...data, productSizeId: sizeId, productSizeLabel: label });
    try {
      const res = await fetch("/api/mill-live/product-size", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sizeId }),
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { productSizeId: number; productSizeLabel: string | null };
      };
      if (!res.ok || !json.success || !json.data) {
        setData(previous);
        toast.error(json.error || t("toastSizeError"));
        return;
      }
      setData((current) =>
        current
          ? {
              ...current,
              productSizeId: json.data!.productSizeId,
              productSizeLabel: json.data!.productSizeLabel,
            }
          : current,
      );
      toast.success(t("toastSizeSaved"));
    } catch {
      setData(previous);
      toast.error(t("toastSizeError"));
    } finally {
      savingSizeRef.current = false;
      setSavingSize(false);
    }
  }

  const dayHours = data?.hourlyBreakdown.slice(0, 12) ?? [];
  const nightHours = data?.hourlyBreakdown.slice(12, 24) ?? [];
  const dayTotal = dayHours.reduce((a, b) => a + b, 0);
  const nightTotal = nightHours.reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl">
      {loading && !data ? (
        <div className="h-[36rem] animate-pulse rounded-2xl bg-zinc-900" aria-hidden />
      ) : error && !data ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-950/40 px-6 py-16 text-center text-sm text-red-200">
          {t("loadError")}
        </div>
      ) : !data ? (
        <div className="rounded-2xl border border-white/10 bg-zinc-950 px-6 py-16 text-center text-sm text-zinc-400">
          {t("empty")}
        </div>
      ) : (
        <div className="relative min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#070b14] text-zinc-100 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.045]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-amber-400/50 to-transparent"
          />

          <header className="relative flex flex-col gap-3 border-b border-white/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-400">
                {t("eyebrow")}
              </p>
              <h1 className="mt-0.5 truncate text-lg font-semibold tracking-tight sm:text-xl">
                {t("hourlyTitle")}
              </h1>
            </div>
            <p className="hidden text-sm font-semibold tracking-[0.18em] text-zinc-200 sm:block">
              {tBrand("header")}
            </p>
            <StatusStrip
              loading={loading}
              error={error}
              isLive={data.isLive}
              lastAt={data.createdAt ?? undefined}
              t={t}
            />
          </header>

          <div className="relative grid min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)_minmax(0,1fr)]">
            <HourColumn
              className="order-2 lg:order-1 lg:border-e lg:border-white/8"
              title={t("dayShift")}
              windowLabel={t("dayWindow")}
              totalLabel={t("totalCount")}
              total={dayTotal}
              slots={DAY_SLOTS}
              counts={dayHours}
              currentHour={clockHour}
              hourRangeLabel={t}
            />

            <CenterPanel
              className="order-1 border-b border-white/8 lg:order-2 lg:border-b-0"
              sizeLabel={t("productSize")}
              sizeValue={data.productSizeLabel ?? t("sizeNotSet")}
              clock={formatDateTime(now)}
              totalLabel={t("totalBillets")}
              totalValue={formatInteger(data.totalBillets)}
              frontLabel={t("frontPack")}
              frontValue={formatInteger(data.frontPackCount)}
              backLabel={t("backPack")}
              backValue={formatInteger(data.backPackCount)}
              sizeEditor={
                data.canEditProductSize
                  ? {
                      items: sizeItems,
                      value:
                        data.productSizeId != null
                          ? String(data.productSizeId)
                          : null,
                      placeholder: t("selectSize"),
                      saving: savingSize,
                      dir,
                      onSelect: persistProductSize,
                    }
                  : undefined
              }
            />

            <HourColumn
              className="order-3 lg:border-s lg:border-white/8"
              title={t("nightShift")}
              windowLabel={t("nightWindow")}
              totalLabel={t("totalCount")}
              total={nightTotal}
              slots={NIGHT_SLOTS}
              counts={nightHours}
              currentHour={clockHour}
              hourRangeLabel={t}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CenterPanel({
  className,
  sizeLabel,
  sizeValue,
  clock,
  totalLabel,
  totalValue,
  frontLabel,
  frontValue,
  backLabel,
  backValue,
  sizeEditor,
}: {
  className?: string;
  sizeLabel: string;
  sizeValue: string;
  clock: string;
  totalLabel: string;
  totalValue: string;
  frontLabel: string;
  frontValue: string;
  backLabel: string;
  backValue: string;
  sizeEditor?: {
    items: Array<{ value: string; label: string }>;
    value: string | null;
    placeholder: string;
    saving: boolean;
    dir: "rtl" | "ltr";
    onSelect: (sizeId: number) => void;
  };
}) {
  return (
    <section
      className={cn(
        "relative flex min-w-0 flex-col items-center justify-center px-5 py-8 text-center sm:px-8 sm:py-10",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute start-1/2 top-[38%] h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400/10 blur-3xl"
      />

      <p className="relative text-sm font-semibold text-zinc-300">
        {sizeLabel}
      </p>
      {sizeEditor ? (
        <div className="relative mt-2 flex w-full max-w-[18rem] justify-center">
          <Select
            items={sizeEditor.items}
            value={sizeEditor.value}
            onValueChange={(v) => {
              if (!v) return;
              const id = Number.parseInt(v, 10);
              if (Number.isInteger(id) && id > 0) sizeEditor.onSelect(id);
            }}
            disabled={sizeEditor.saving}
          >
            <SelectTrigger
              className="weight-value h-auto min-h-0 w-full justify-center border-white/15 bg-white/[0.04] px-3 py-2 text-5xl font-semibold tracking-tight text-amber-400 shadow-none hover:bg-white/[0.07] focus-visible:border-amber-400/40 focus-visible:ring-amber-400/25 data-[size=default]:h-auto sm:text-6xl dark:bg-white/[0.04] dark:hover:bg-white/[0.07] [&_svg]:size-6 [&_svg]:text-amber-400/70 [&_[data-slot=select-value]]:justify-center"
            >
              <SelectValue placeholder={sizeEditor.placeholder} />
            </SelectTrigger>
            <SelectContent dir={sizeEditor.dir}>
              {sizeEditor.items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="relative mt-2 font-semibold tracking-tight text-amber-400 weight-value text-6xl sm:text-7xl">
          {sizeValue}
        </p>
      )}
      <p className="relative mt-3 text-sm tabular-nums text-zinc-400 weight-value">
        {clock}
      </p>

      <div className="relative mt-10 w-full max-w-[17rem]">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-5">
          <p className="text-sm font-semibold text-zinc-300">
            {totalLabel}
          </p>
          <p className="mt-2 font-semibold tracking-tight text-emerald-400 weight-value text-5xl">
            {totalValue}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <MetricTile label={frontLabel} value={frontValue} />
          <MetricTile label={backLabel} value={backValue} />
        </div>
      </div>
    </section>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
      <p className="text-[13px] font-medium leading-snug text-zinc-300">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-emerald-400 weight-value">
        {value}
      </p>
    </div>
  );
}

function HourColumn({
  className,
  title,
  windowLabel,
  totalLabel,
  total,
  slots,
  counts,
  currentHour,
  hourRangeLabel,
}: {
  className?: string;
  title: string;
  windowLabel: string;
  totalLabel: string;
  total: number;
  slots: Array<{ start: number; end: number }>;
  counts: number[];
  currentHour: number;
  hourRangeLabel: ReturnType<typeof useTranslations<"millLive">>;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col", className)}>
      <div className="flex items-end justify-between gap-3 px-4 pb-2 pt-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold text-zinc-100">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400 weight-value">{windowLabel}</p>
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto">
        <table className="w-full min-w-[240px]">
          <tbody>
            {slots.map((slot, idx) => {
              const count = counts[idx] ?? 0;
              const isCurrent = slot.start === currentHour;
              return (
                <tr
                  key={`${slot.start}-${slot.end}`}
                  className={cn(
                    "border-t border-white/6",
                    isCurrent && "bg-amber-400/8",
                  )}
                >
                  <td
                    className={cn(
                      "relative py-2 ps-4 pe-2 text-start text-[13px] tabular-nums text-zinc-400 weight-value",
                      isCurrent &&
                        "text-zinc-200 before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-amber-400",
                    )}
                  >
                    {hourRangeLabel("hourRange", {
                      start: hourLabel(slot.start),
                      end: hourLabel(slot.end),
                    })}
                  </td>
                  <td
                    className={cn(
                      "py-2 pe-4 ps-2 text-end text-[1.35rem] font-semibold leading-none tabular-nums weight-value",
                      count > 0 ? "text-emerald-400" : "text-zinc-600",
                    )}
                  >
                    {formatInteger(count)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/10 bg-white/[0.03] px-4 py-3">
        <span className="text-sm font-semibold text-zinc-300">
          {totalLabel}
        </span>
        <span className="text-2xl font-semibold text-emerald-400 weight-value">
          {formatInteger(total)}
        </span>
      </div>
    </section>
  );
}

function StatusStrip({
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
  let dot = "bg-amber-400";
  let ping = false;

  if (loading && !lastAt) {
    label = t("loading");
    dot = "bg-zinc-500";
  } else if (error && !lastAt) {
    label = t("statusError");
    dot = "bg-red-400";
  } else if (!lastAt) {
    label = t("statusWaiting");
    dot = "bg-zinc-500";
  } else if (isLive) {
    label = t("statusLive");
    dot = "bg-emerald-400";
    ping = true;
  }

  return (
    <div className="flex shrink-0 flex-col items-start gap-0.5 sm:items-end">
      <span className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-100">
        <span className="relative flex h-1.5 w-1.5">
          {ping ? (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          ) : null}
          <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", dot)} />
        </span>
        {label}
      </span>
      {lastAt ? (
        <span className="text-[11px] text-zinc-400">
          {t("lastUpdate", { time: formatDateTime(lastAt) })}
        </span>
      ) : null}
    </div>
  );
}
