"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  FileSpreadsheet,
  Loader2,
  Users,
} from "lucide-react";
import { getTextDirection, type Locale } from "@/i18n/config";
import { formatDateTime } from "@/lib/date-format";
import { exportLoaderTrucksExcel } from "@/lib/export/loader-trucks-excel";
import type { LoaderTrucksReport } from "@/lib/services/report.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

function firstDayOfCurrentMonthInput(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function todayInput(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function SummaryCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold tabular-nums">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function LoaderTrucksReportView({
  analyticsStartDate,
}: {
  analyticsStartDate: string | null;
}) {
  const t = useTranslations("reports.loaderTrucks");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);

  const [fromDate, setFromDate] = useState(() => {
    const monthStart = firstDayOfCurrentMonthInput();
    return analyticsStartDate && analyticsStartDate > monthStart
      ? analyticsStartDate
      : monthStart;
  });
  const [toDate, setToDate] = useState(() => todayInput());
  const [loadingReport, setLoadingReport] = useState(false);
  const [report, setReport] = useState<LoaderTrucksReport | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!fromDate || !toDate) {
      toast.error(t("selectRange"));
      return;
    }

    let cancelled = false;
    (async () => {
      setLoadingReport(true);
      try {
        const params = new URLSearchParams({ from: fromDate, to: toDate });
        const res = await fetch(`/api/reports/loader-trucks?${params.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.success) {
          toast.error(json.error ?? t("loadFailed"));
          setReport(null);
          return;
        }
        setReport(json.data as LoaderTrucksReport);
        setExpanded(new Set());
      } catch {
        if (!cancelled) {
          toast.error(t("loadFailed"));
          setReport(null);
        }
      } finally {
        if (!cancelled) setLoadingReport(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate, t]);

  function toggleEmployee(userId: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function handleExport() {
    if (!report || report.loaders.length === 0) return;
    exportLoaderTrucksExcel(report, {
      title: t("excelTitle"),
      from: t("from"),
      to: t("to"),
      generated: t("excelGenerated"),
      window: t("excelWindow"),
      employees: t("loaders"),
      distinctTrucks: t("distinctTrucks"),
      trucks: t("trucks"),
      rounds: t("rounds"),
      employee: t("employee"),
      plate: t("plate"),
      round: t("round"),
      confirmedAt: t("confirmedAt"),
      summarySheet: t("excelSummarySheet"),
      detailSheet: t("excelDetailSheet"),
    });
  }

  return (
    <div dir={dir} className="flex-1 space-y-6 p-4 sm:p-6 min-w-0 max-w-full">
      <div className="flex min-w-0 flex-wrap items-start gap-3">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          {t("back")}
        </Link>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "oklch(0.650 0.140 30 / 12%)",
            boxShadow: "inset 0 0 0 1px oklch(0.650 0.140 30 / 25%)",
          }}
        >
          <Users className="h-5 w-5" style={{ color: "oklch(0.650 0.140 30)" }} />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <div className="min-w-[10rem] space-y-1.5">
          <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            {t("from")}
          </label>
          <Input
            type="date"
            value={fromDate}
            min={analyticsStartDate ?? undefined}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full min-w-[10rem]"
          />
        </div>
        <div className="min-w-[10rem] space-y-1.5">
          <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            {t("to")}
          </label>
          <Input
            type="date"
            value={toDate}
            min={analyticsStartDate ?? undefined}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full min-w-[10rem]"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleExport}
          disabled={!report || report.loaders.length === 0 || loadingReport}
        >
          <FileSpreadsheet className="h-4 w-4" />
          <span className="ms-2">{t("export")}</span>
        </Button>
        {loadingReport ? (
          <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {loadingReport && !report ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {report ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t("window")}: <span className="tabular-nums">{report.windowLabel}</span>
          </p>
          {report.windowClamped && report.analyticsStartDate ? (
            <p className="text-sm text-muted-foreground">
              {t("windowClamped", { date: report.analyticsStartDate })}
            </p>
          ) : null}

          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            <SummaryCard label={t("loaders")} value={report.totals.loaderCount} />
            <SummaryCard
              label={t("distinctTrucks")}
              value={report.totals.truckCount}
              hint={t("distinctTrucksHint")}
            />
            <SummaryCard label={t("totalRounds")} value={report.totals.roundCount} />
          </div>

          <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12" />
                  <TableHead>{t("employee")}</TableHead>
                  <TableHead>{t("trucks")}</TableHead>
                  <TableHead>{t("rounds")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.loaders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      {t("empty")}
                    </TableCell>
                  </TableRow>
                ) : (
                  report.loaders.map((row) => {
                    const open = expanded.has(row.userId);
                    return (
                      <Fragment key={row.userId}>
                        <TableRow>
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-expanded={open}
                              aria-label={
                                open
                                  ? t("hideTrucks", { name: row.fullName })
                                  : t("showTrucks", { name: row.fullName })
                              }
                              onClick={() => toggleEmployee(row.userId)}
                            >
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 transition-transform",
                                  open && "rotate-180",
                                )}
                              />
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">{row.fullName}</TableCell>
                          <TableCell className="tabular-nums">{row.truckCount}</TableCell>
                          <TableCell className="tabular-nums">{row.roundCount}</TableCell>
                        </TableRow>
                        {open ? (
                          <TableRow>
                            <TableCell
                              colSpan={4}
                              className="bg-muted/30 p-0 whitespace-normal"
                            >
                              {/* width 0 + min-w-full keeps this scroller inside the
                                  parent cell so the detail table cannot widen the page. */}
                              <div className="w-0 min-w-full overflow-x-auto">
                                <table className="w-full min-w-[480px] caption-bottom text-sm">
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>{t("plate")}</TableHead>
                                      <TableHead>{t("round")}</TableHead>
                                      <TableHead>{t("confirmedAt")}</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {row.rounds.map((item) => (
                                      <TableRow
                                        key={`${item.truckOperationId}-${item.roundNumber}`}
                                      >
                                        <TableCell className="tabular-nums" dir="ltr">
                                          {item.plateNumber}
                                        </TableCell>
                                        <TableCell className="tabular-nums">
                                          {item.roundNumber}
                                        </TableCell>
                                        <TableCell className="tabular-nums" dir="ltr">
                                          {formatDateTime(item.loadingConfirmedAt)}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </table>
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}
    </div>
  );
}
