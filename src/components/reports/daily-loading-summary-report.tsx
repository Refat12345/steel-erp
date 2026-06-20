"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarDays,
  Download,
  FileSpreadsheet,
  Layers,
  Loader2,
  Printer,
  RefreshCw,
} from "lucide-react";
import { sessionHasPermission } from "@/lib/client-permissions";
import { formatDateTime } from "@/lib/date-format";
import { toEnglishCity, toEnglishSize, productFilterLabelEn } from "@/lib/en-labels";
import { BRAND } from "@/lib/brand";
import { defaultOperationalDateInput } from "@/lib/operational-day";
import { exportDailyLoadingSummaryExcel } from "@/lib/export/daily-loading-summary-excel";
import {
  computeA4LandscapePrintFitScale,
  SCALE_CARD_PRINT_HEIGHT_FUDGE,
} from "@/lib/scale-card-print-fit";
import type { DailyLoadingSummary } from "@/lib/services/report.service";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";

interface CustomerOption {
  id: number;
  code: string;
  fullName: string;
}

const PRODUCT_FILTER_OPTIONS = [
  { value: "FIRST", label: "First grade" },
  { value: "SECOND", label: "Second grade" },
  { value: "SHORTBAR", label: "Short bars" },
  { value: "SCRAP", label: "Scrap" },
  { value: "BILLET_WIRE", label: "Billet tying wire" },
] as const;

const PERIOD_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
] as const;

function fmtTons(value: number | null | undefined): string {
  if (value == null) return "-";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function fmtPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function fmtSizeTons(value: number | null | undefined): string {
  if (value == null) return "-";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Signed tons, e.g. "+1.250" / "−0.840" (uses a real minus sign). */
function fmtSignedTons(value: number): string {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${fmtTons(Math.abs(value))}`;
}

/**
 * Bridge (external weighbridge) and internal (sum of weigh sessions) totals are
 * two independent measurements and never match exactly. A difference within
 * this percentage of the dispatched total is treated as normal, not an error.
 */
const RECONCILE_TOLERANCE_PCT = 2;

function computeReconciliation(bridge: number, internal: number) {
  const diffTons = Math.round((bridge - internal) * 1000) / 1000;
  const diffPct = bridge !== 0 ? (Math.abs(diffTons) / bridge) * 100 : 0;
  return {
    diffTons,
    diffPct,
    withinTolerance: diffPct <= RECONCILE_TOLERANCE_PCT,
  };
}

/** "2026-06-06" → "6/6/2026" (M/D/YYYY, no leading zeros), matching the office file. */
function fmtLoadingDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
}

/** Period-aware label, e.g. "Loading date: 6/6/2026" / "Week: …" / "Month: June 2026". */
function periodLabel(report: DailyLoadingSummary): string {
  if (report.period === "weekly") {
    return `Week: ${fmtLoadingDate(report.periodStartDate)} → ${fmtLoadingDate(report.periodEndDate)}`;
  }
  if (report.period === "monthly") {
    const [y, m] = report.periodStartDate.split("-").map(Number);
    const monthName = new Date(y, m - 1, 1).toLocaleString("en-US", {
      month: "long",
    });
    return `Month: ${monthName} ${y}`;
  }
  return `Loading date: ${fmtLoadingDate(report.periodStartDate)}`;
}

function buildHeaderLine(report: DailyLoadingSummary): string {
  return [
    periodLabel(report),
    `Trucks: ${report.totals.truckCount}`,
    `Total dispatched: ${fmtTons(report.totals.totalBridgeTons)} t`,
    `generated ${formatDateTime(report.generatedAt)}`,
  ].join(" | ");
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold tabular-nums">{value}</p>
        {sub ? <p className="text-xs text-muted-foreground mt-1">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

function ReconciliationCard({
  bridge,
  internal,
}: {
  bridge: number;
  internal: number;
}) {
  const { diffTons, diffPct, withinTolerance } = computeReconciliation(
    bridge,
    internal,
  );
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div>
          <h2 className="text-base font-semibold">
            Reconciliation: dispatched vs internal
          </h2>
          <p className="text-xs text-muted-foreground">
            Dispatched total is the external weighbridge (قبان) net weight; the
            by-size table is summed from internal weigh sessions. The two are
            independent measurements, so a small difference is expected — it is
            not a report error.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">
              Total dispatched (قبان)
            </p>
            <p className="text-lg font-bold tabular-nums">
              {fmtTons(bridge)} <span className="text-xs font-normal">t</span>
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">
              Total by size (internal)
            </p>
            <p className="text-lg font-bold tabular-nums">
              {fmtTons(internal)} <span className="text-xs font-normal">t</span>
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Difference</p>
            <p className="text-lg font-bold tabular-nums">
              {fmtSignedTons(diffTons)}{" "}
              <span className="text-xs font-normal">
                t ({fmtPct(diffPct)})
              </span>
            </p>
            <span
              className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                withinTolerance
                  ? "bg-green-100 text-green-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {withinTolerance
                ? `Within ±${RECONCILE_TOLERANCE_PCT}% tolerance`
                : `Exceeds ±${RECONCILE_TOLERANCE_PCT}% — review`}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function DailyLoadingSummaryView() {
  const { data: session, status } = useSession();
  const canView = sessionHasPermission(session, "report.daily_trucks");

  const [operationalDate, setOperationalDate] = useState(() =>
    defaultOperationalDateInput(),
  );
  const [period, setPeriod] = useState<string>("daily");
  const [customerId, setCustomerId] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [report, setReport] = useState<DailyLoadingSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCustomers(true);
      try {
        const res = await fetch("/api/customers?active=true&pageSize=100");
        const json = await res.json();
        if (!cancelled && json.success && Array.isArray(json.data)) {
          setCustomers(json.data);
        }
      } catch {
        if (!cancelled) toast.error("Failed to load customers");
      } finally {
        if (!cancelled) setLoadingCustomers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchReport = useCallback(async () => {
    if (!operationalDate) {
      toast.error("Select an operational date");
      return;
    }
    setLoadingReport(true);
    try {
      const params = new URLSearchParams({ date: operationalDate, period });
      if (customerId !== "all") params.set("customerId", customerId);
      if (productFilter !== "all") params.set("product", productFilter);
      const res = await fetch(
        `/api/reports/daily-loading-summary?${params.toString()}`,
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json.error ?? "Failed to load the report");
        setReport(null);
        return;
      }
      setReport(json.data as DailyLoadingSummary);
    } catch {
      toast.error("Failed to load the report");
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, [operationalDate, period, customerId, productFilter]);

  useEffect(() => {
    if (status === "authenticated" && canView) {
      void fetchReport();
    }
  }, [canView, fetchReport, status]);

  const hasExportableReport = !!report && report.totals.truckCount > 0;

  const handleExportExcel = useCallback(() => {
    if (!report) return;
    try {
      exportDailyLoadingSummaryExcel(report);
    } catch {
      toast.error("Failed to export the Excel file");
    }
  }, [report]);

  const handlePrint = useCallback(() => {
    if (!report) return;
    window.print();
  }, [report]);

  if (status === "loading") {
    return (
      <div className="flex-1 p-4 sm:p-6 space-y-6 min-w-0 max-w-full">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view this report
        </p>
      </div>
    );
  }

  return (
    <div dir="ltr" className="flex-1 p-4 sm:p-6 space-y-6 min-w-0 max-w-full text-left">
      <div className="flex flex-wrap items-start gap-3 min-w-0">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Reports
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 min-w-0">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "oklch(0.650 0.140 30 / 12%)",
            boxShadow: "inset 0 0 0 1px oklch(0.650 0.140 30 / 25%)",
          }}
        >
          <Layers className="h-5 w-5" style={{ color: "oklch(0.650 0.140 30)" }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">
            {BRAND.name} — Loading Summary
          </h1>
          <p className="text-sm text-muted-foreground">
            Operational day cutoff 08:00 (Asia/Damascus)
          </p>
          {report ? (
            <p className="text-xs text-muted-foreground mt-1">
              {periodLabel(report)} &middot; {report.windowLabelAr}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 min-w-0">
        <div className="space-y-1.5 min-w-[9rem]">
          <label className="text-xs font-medium text-muted-foreground">Period</label>
          <Select value={period} onValueChange={(v) => setPeriod(v ?? "daily")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Daily" />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 min-w-[10rem]">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            {period === "monthly"
              ? "Month (any date in it)"
              : period === "weekly"
                ? "Week (any date in it)"
                : "Operational date"}
          </label>
          <Input
            type="date"
            value={operationalDate}
            onChange={(e) => setOperationalDate(e.target.value)}
            className="w-full min-w-[10rem]"
          />
        </div>

        <div className="space-y-1.5 min-w-[12rem] flex-1 sm:max-w-xs">
          <label className="text-xs font-medium text-muted-foreground">Customer</label>
          <Select
            value={customerId}
            onValueChange={(v) => setCustomerId(v ?? "all")}
            disabled={loadingCustomers}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All customers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All customers</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.code} — {c.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 min-w-[10rem]">
          <label className="text-xs font-medium text-muted-foreground">Product</label>
          <Select value={productFilter} onValueChange={(v) => setProductFilter(v ?? "all")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All products" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All products</SelectItem>
              {PRODUCT_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button onClick={() => void fetchReport()} disabled={loadingReport}>
          {loadingReport ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2">Show report</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setOperationalDate(defaultOperationalDateInput());
            setPeriod("daily");
            setCustomerId("all");
            setProductFilter("all");
          }}
        >
          Clear filters
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="outline" disabled={!hasExportableReport}>
                <Download className="h-4 w-4" />
                <span className="ml-2">Export</span>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Export report</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleExportExcel}>
              <FileSpreadsheet className="h-4 w-4" />
              <span className="ml-2">Export Excel</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handlePrint}>
              <Printer className="h-4 w-4" />
              <span className="ml-2">Print / PDF</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {loadingReport && !report ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : report ? (
        <>
          <div className="grid grid-cols-2 gap-3 min-w-0">
            <SummaryCard label="Trucks" value={report.totals.truckCount} />
            <SummaryCard
              label="Total dispatched (bridge)"
              value={fmtTons(report.totals.totalBridgeTons)}
              sub="t"
            />
          </div>

          {report.totals.totalInternalTons != null ? (
            <ReconciliationCard
              bridge={report.totals.totalBridgeTons}
              internal={report.totals.totalInternalTons}
            />
          ) : null}

          {report.filters.customerName ? (
            <p className="text-sm text-muted-foreground">
              Customer filter:{" "}
              <span className="font-medium">{report.filters.customerName}</span>
            </p>
          ) : null}
          {report.filters.productFilter ? (
            <p className="text-sm text-muted-foreground">
              Product filter:{" "}
              <span className="font-medium">
                {productFilterLabelEn(report.filters.productFilter)}
              </span>
              {" · "}
              Bridge tons from matching rounds only; mixed visits may appear in more
              than one product filter.
            </p>
          ) : null}

          <Card className="shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div>
                <h2 className="text-base font-semibold">1. By customer</h2>
                <p className="text-xs text-muted-foreground">
                  Bridge (قبان) weight of trucks dispatched within the operational day
                </p>
              </div>
              <div className="rounded-lg border overflow-x-auto min-w-0">
                <Table dir="ltr" className="min-w-[520px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Loads</TableHead>
                      <TableHead className="text-right">Tons</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byCustomer.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          No loads for this day
                        </TableCell>
                      </TableRow>
                    ) : (
                      report.byCustomer.map((row) => (
                        <TableRow key={row.customerId ?? "none"}>
                          <TableCell className="font-medium">{row.customerName}</TableCell>
                          <TableCell className="font-mono tabular-nums text-right">
                            {row.loads}
                          </TableCell>
                          <TableCell className="font-mono tabular-nums text-right">
                            {fmtTons(row.tons)}
                          </TableCell>
                          <TableCell className="font-mono tabular-nums text-right">
                            {fmtPct(row.sharePct)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  {report.byCustomer.length > 0 ? (
                    <TableFooter>
                      <TableRow>
                        <TableCell className="font-semibold">Total</TableCell>
                        <TableCell className="font-mono tabular-nums text-right font-semibold">
                          {report.totals.truckCount}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums text-right font-semibold">
                          {fmtTons(report.totals.totalBridgeTons)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums text-right font-semibold">
                          100.0%
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  ) : null}
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div>
                <h2 className="text-base font-semibold">2. By city</h2>
                <p className="text-xs text-muted-foreground">
                  Bridge weight by truck destination
                </p>
              </div>
              <div className="rounded-lg border overflow-x-auto min-w-0">
                <Table dir="ltr" className="min-w-[520px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>City</TableHead>
                      <TableHead className="text-right">Loads</TableHead>
                      <TableHead className="text-right">Tons</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byCity.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          No loads for this day
                        </TableCell>
                      </TableRow>
                    ) : (
                      report.byCity.map((row) => (
                        <TableRow key={row.destinationId ?? "none"}>
                          <TableCell className="font-medium">{toEnglishCity(row.cityName)}</TableCell>
                          <TableCell className="font-mono tabular-nums text-right">
                            {row.loads}
                          </TableCell>
                          <TableCell className="font-mono tabular-nums text-right">
                            {fmtTons(row.tons)}
                          </TableCell>
                          <TableCell className="font-mono tabular-nums text-right">
                            {fmtPct(row.sharePct)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  {report.byCity.length > 0 ? (
                    <TableFooter>
                      <TableRow>
                        <TableCell className="font-semibold">Total</TableCell>
                        <TableCell className="font-mono tabular-nums text-right font-semibold">
                          {report.totals.truckCount}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums text-right font-semibold">
                          {fmtTons(report.totals.totalBridgeTons)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums text-right font-semibold">
                          100.0%
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  ) : null}
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div>
                <h2 className="text-base font-semibold">3. By size within each city (t)</h2>
                <p className="text-xs text-muted-foreground">
                  Computed from internal weigh-session weights — its total is
                  expected to differ slightly from the dispatched (قبان) total;
                  see the reconciliation above.
                </p>
              </div>
              <div className="rounded-lg border overflow-x-auto min-w-0">
                <Table dir="ltr" className="min-w-[640px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>City</TableHead>
                      {report.sizeColumns.map((col) => (
                        <TableHead key={col.key} className="text-right">
                          {toEnglishSize(col.displayName, col.code)}
                        </TableHead>
                      ))}
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byCitySize.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={report.sizeColumns.length + 2}
                          className="text-center py-8 text-muted-foreground"
                        >
                          No internal weights for this day
                        </TableCell>
                      </TableRow>
                    ) : (
                      report.byCitySize.map((row) => (
                        <TableRow key={row.destinationId ?? "none"}>
                          <TableCell className="font-medium">{toEnglishCity(row.cityName)}</TableCell>
                          {report.sizeColumns.map((col) => (
                            <TableCell
                              key={col.key}
                              className="font-mono tabular-nums text-right"
                            >
                              {row.sizeTons[col.key] != null
                                ? fmtTons(row.sizeTons[col.key])
                                : "-"}
                            </TableCell>
                          ))}
                          <TableCell className="font-mono tabular-nums text-right font-medium">
                            {fmtTons(row.totalTons)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  {report.byCitySize.length > 0 ? (
                    <TableFooter>
                      <TableRow>
                        <TableCell className="font-semibold">Total</TableCell>
                        {report.sizeColumns.map((col) => (
                          <TableCell
                            key={col.key}
                            className="font-mono tabular-nums text-right font-semibold"
                          >
                            {fmtTons(report.citySizeColumnTotals[col.key])}
                          </TableCell>
                        ))}
                        <TableCell className="font-mono tabular-nums text-right font-semibold">
                          {fmtTons(report.totals.totalInternalTons)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  ) : null}
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {report ? <DailyLoadingSummaryPrintable report={report} /> : null}
    </div>
  );
}

/* Base typography is written OUTSIDE @media print so it also applies while the
   printable is measured off-screen — measurement must match the real print
   layout for the scale-to-fit math to be accurate. */
const PRINT_STYLE = `
#loading-summary-print {
  color: #000;
  font-family: Calibri, Arial, sans-serif;
  font-size: 10px;
  line-height: 1.2;
  background: #fff;
  transform-origin: top left;
}
#loading-summary-print .print-title {
  font-size: 13px;
  font-weight: 700;
  margin: 0 0 2px;
}
#loading-summary-print .section-title {
  color: #2b3f55;
  font-size: 12px;
  font-weight: 700;
  margin: 12px 0 7px 6px;
}
#loading-summary-print table {
  border: 1px solid #c7d1df;
  border-collapse: collapse;
  margin-bottom: 11px;
  table-layout: fixed;
}
#loading-summary-print .narrow-table {
  width: 58%;
  margin-left: auto;
  margin-right: auto;
}
#loading-summary-print .wide-table {
  width: 100%;
}
#loading-summary-print th, #loading-summary-print td {
  border: 1px solid #c7d1df;
  padding: 4px 7px;
  text-align: left;
  word-break: break-word;
  overflow-wrap: anywhere;
}
#loading-summary-print th {
  background: #1f3864;
  color: #fff;
  font-weight: 700;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#loading-summary-print tbody tr:nth-child(even):not(.total-row) td {
  background: #f1f4fa;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#loading-summary-print .total-row td {
  background: #dbe5f3;
  font-weight: 700;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#loading-summary-print thead { display: table-header-group; }
#loading-summary-print tr { break-inside: avoid; }
#loading-summary-print .num { text-align: right; font-variant-numeric: tabular-nums; }
#loading-summary-print .headline { font-size: 10px; color: #222; margin: 0 0 4px; }
#loading-summary-print .pagefoot { text-align: center; font-size: 10px; color: #555; margin-top: 14px; }

@media screen {
  /* Hidden on screen, except briefly while measuring: rendered off-canvas at
     the exact landscape printable width so its height matches the printout. */
  #loading-summary-print { display: none; }
  #loading-summary-print.is-measuring {
    display: block;
    position: fixed;
    left: -10000px;
    top: 0;
    width: 277mm;
    background: #fff;
  }
}
@media print {
  /* Landscape so the City × size cross-tab fits without being cut off. */
  @page { size: landscape; margin: 10mm; }
  html, body { background: #fff !important; }
  /* The printable is portaled to <body>; hide everything else so the
     report prints from the top and paginates normally (no clipping). */
  body > *:not(#loading-summary-print) { display: none !important; }
  #loading-summary-print {
    display: block;
    width: 100%;
  }
}
`;

/**
 * Below this scale the print would become unreadable; instead of shrinking
 * further we let the report flow naturally onto multiple pages.
 */
const MIN_PRINT_FIT_SCALE = 0.6;

function DailyLoadingSummaryPrintable({ report }: { report: DailyLoadingSummary }) {
  const printRef = useRef<HTMLDivElement>(null);

  const resetPrintFit = useCallback(() => {
    const el = printRef.current;
    if (!el) return;
    el.classList.remove("is-measuring");
    el.style.zoom = "";
    el.style.transform = "";
  }, []);

  const applyPrintFit = useCallback(() => {
    const el = printRef.current;
    if (!el) return;

    resetPrintFit();

    // Render off-canvas at the real print width, then measure true height.
    el.classList.add("is-measuring");
    const width = el.scrollWidth;
    const height = Math.max(el.scrollHeight, el.getBoundingClientRect().height);
    el.classList.remove("is-measuring");

    const scale = computeA4LandscapePrintFitScale(
      width,
      height * SCALE_CARD_PRINT_HEIGHT_FUDGE,
    );

    // Already fits, or so large that shrinking would hurt readability → leave
    // it to paginate naturally across multiple pages.
    if (scale >= 0.999 || scale < MIN_PRINT_FIT_SCALE) return;

    if (typeof CSS !== "undefined" && CSS.supports("zoom", "1")) {
      el.style.zoom = String(scale);
      return;
    }
    el.style.transform = `scale(${scale})`;
  }, [resetPrintFit]);

  useEffect(() => {
    const onBeforePrint = () => applyPrintFit();
    const onAfterPrint = () => resetPrintFit();
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
      resetPrintFit();
    };
  }, [applyPrintFit, resetPrintFit]);

  const content = (
    <div id="loading-summary-print" dir="ltr" ref={printRef}>
        <h1 className="print-title">{BRAND.name} — Loading Summary</h1>
        <p className="headline">{buildHeaderLine(report)}</p>
        {report.filters.customerName ? (
          <p className="headline">Customer filter: {report.filters.customerName}</p>
        ) : null}
        {report.filters.productFilter ? (
          <p className="headline">
            Product filter: {productFilterLabelEn(report.filters.productFilter)}
          </p>
        ) : null}

        <h2 className="section-title">1. By customer</h2>
        <table className="narrow-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th className="num">Loads</th>
              <th className="num">Tons</th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {report.byCustomer.map((row) => (
              <tr key={row.customerId ?? "none"}>
                <td>{row.customerName}</td>
                <td className="num">{row.loads}</td>
                <td className="num">{fmtTons(row.tons)}</td>
                <td className="num">{fmtPct(row.sharePct)}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td>Total</td>
              <td className="num">{report.totals.truckCount}</td>
              <td className="num">{fmtTons(report.totals.totalBridgeTons)}</td>
              <td className="num">100.0%</td>
            </tr>
          </tbody>
        </table>

        <h2 className="section-title">2. By city</h2>
        <table className="narrow-table">
          <thead>
            <tr>
              <th>City</th>
              <th className="num">Loads</th>
              <th className="num">Tons</th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {report.byCity.map((row) => (
              <tr key={row.destinationId ?? "none"}>
                <td>{toEnglishCity(row.cityName)}</td>
                <td className="num">{row.loads}</td>
                <td className="num">{fmtTons(row.tons)}</td>
                <td className="num">{fmtPct(row.sharePct)}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td>Total</td>
              <td className="num">{report.totals.truckCount}</td>
              <td className="num">{fmtTons(report.totals.totalBridgeTons)}</td>
              <td className="num">100.0%</td>
            </tr>
          </tbody>
        </table>

        <h2 className="section-title">3. By size within each city (t)</h2>
        <table className="wide-table">
          <thead>
            <tr>
              <th>City</th>
              {report.sizeColumns.map((col) => (
                <th key={col.key} className="num">
                  {toEnglishSize(col.displayName, col.code)}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {report.byCitySize.map((row) => (
              <tr key={row.destinationId ?? "none"}>
                <td>{toEnglishCity(row.cityName)}</td>
                {report.sizeColumns.map((col) => (
                  <td key={col.key} className="num">
                    {fmtSizeTons(row.sizeTons[col.key])}
                  </td>
                ))}
                <td className="num">{fmtTons(row.totalTons)}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td>Total</td>
              {report.sizeColumns.map((col) => (
                <td key={col.key} className="num">
                  {fmtSizeTons(report.citySizeColumnTotals[col.key])}
                </td>
              ))}
              <td className="num">{fmtTons(report.totals.totalInternalTons)}</td>
            </tr>
          </tbody>
        </table>

        {report.totals.totalInternalTons != null ? (
          <>
            <h2 className="section-title">4. Reconciliation: dispatched vs internal</h2>
            <p className="headline">
              Dispatched is the external weighbridge (قبان) net weight; the
              by-size total is summed from internal weigh sessions. A small
              difference is expected and is not a report error.
            </p>
            {(() => {
              const { diffTons, diffPct, withinTolerance } =
                computeReconciliation(
                  report.totals.totalBridgeTons,
                  report.totals.totalInternalTons,
                );
              return (
                <table className="narrow-table">
                  <tbody>
                    <tr>
                      <th>Total dispatched (قبان)</th>
                      <td className="num">{fmtTons(report.totals.totalBridgeTons)} t</td>
                    </tr>
                    <tr>
                      <th>Total by size (internal)</th>
                      <td className="num">{fmtTons(report.totals.totalInternalTons)} t</td>
                    </tr>
                    <tr className="total-row">
                      <th>Difference</th>
                      <td className="num">
                        {fmtSignedTons(diffTons)} t ({fmtPct(diffPct)}) —{" "}
                        {withinTolerance
                          ? `within ±${RECONCILE_TOLERANCE_PCT}%`
                          : `exceeds ±${RECONCILE_TOLERANCE_PCT}%, review`}
                      </td>
                    </tr>
                  </tbody>
                </table>
              );
            })()}
          </>
        ) : null}

        <p className="pagefoot">-- 1 of 1 --</p>
      </div>
  );

  return (
    <>
      <style>{PRINT_STYLE}</style>
      {typeof document !== "undefined" ? createPortal(content, document.body) : null}
    </>
  );
}
