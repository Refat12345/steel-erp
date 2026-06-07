"use client";

import { useCallback, useEffect, useState } from "react";
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
import { toEnglishCity, toEnglishSize } from "@/lib/en-labels";
import { BRAND } from "@/lib/brand";
import { defaultOperationalDateInput } from "@/lib/operational-day";
import { exportDailyLoadingSummaryExcel } from "@/lib/export/daily-loading-summary-excel";
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

const GRADE_OPTIONS = [
  { value: "FIRST", label: "First grade" },
  { value: "SECOND", label: "Second grade" },
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

export function DailyLoadingSummaryView() {
  const { data: session, status } = useSession();
  const canView = sessionHasPermission(session, "report.daily_trucks");

  const [operationalDate, setOperationalDate] = useState(() =>
    defaultOperationalDateInput(),
  );
  const [period, setPeriod] = useState<string>("daily");
  const [customerId, setCustomerId] = useState<string>("all");
  const [grade, setGrade] = useState<string>("all");
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
      if (grade !== "all") params.set("grade", grade);
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
  }, [operationalDate, period, customerId, grade]);

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
          <label className="text-xs font-medium text-muted-foreground">Grade</label>
          <Select value={grade} onValueChange={(v) => setGrade(v ?? "all")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All grades" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All grades</SelectItem>
              {GRADE_OPTIONS.map((option) => (
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
            setGrade("all");
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

          {report.filters.customerName ? (
            <p className="text-sm text-muted-foreground">
              Customer filter:{" "}
              <span className="font-medium">{report.filters.customerName}</span>
            </p>
          ) : null}
          {report.filters.grade ? (
            <p className="text-sm text-muted-foreground">
              Grade filter:{" "}
              <span className="font-medium">
                {report.filters.grade === "FIRST" ? "First grade" : "Second grade"}
              </span>
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
                <Table className="min-w-[520px]">
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
                <Table className="min-w-[520px]">
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
                  Computed from internal weigh-session weights
                </p>
              </div>
              <div className="rounded-lg border overflow-x-auto min-w-0">
                <Table className="min-w-[640px]">
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

const PRINT_STYLE = `
@media screen {
  #loading-summary-print { display: none; }
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
    color: #000;
    font-size: 10px;
  }
  #loading-summary-print table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 10px;
    table-layout: fixed;
  }
  #loading-summary-print th, #loading-summary-print td {
    border: 1px solid #999;
    padding: 3px 4px;
    text-align: left;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  #loading-summary-print thead { display: table-header-group; }
  #loading-summary-print tr { break-inside: avoid; }
  #loading-summary-print h1 { font-size: 14px; margin: 0 0 2px; }
  #loading-summary-print h2 { font-size: 12px; margin: 12px 0 4px; }
  #loading-summary-print .num { text-align: right; font-variant-numeric: tabular-nums; }
  #loading-summary-print .headline { font-size: 10px; color: #222; margin: 0 0 4px; }
  #loading-summary-print .pagefoot { text-align: center; font-size: 10px; color: #555; margin-top: 14px; }
}
`;

function DailyLoadingSummaryPrintable({ report }: { report: DailyLoadingSummary }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const content = (
    <div id="loading-summary-print" dir="ltr">
        <h1>{BRAND.name} — Loading Summary</h1>
        <p className="headline">{buildHeaderLine(report)}</p>
        {report.filters.customerName ? (
          <p className="headline">Customer filter: {report.filters.customerName}</p>
        ) : null}
        {report.filters.grade ? (
          <p className="headline">
            Grade filter:{" "}
            {report.filters.grade === "FIRST" ? "First grade" : "Second grade"}
          </p>
        ) : null}

        <h2>1. By customer</h2>
        <table>
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
            <tr>
              <td>Total</td>
              <td className="num">{report.totals.truckCount}</td>
              <td className="num">{fmtTons(report.totals.totalBridgeTons)}</td>
              <td className="num">100.0%</td>
            </tr>
          </tbody>
        </table>

        <h2>2. By city</h2>
        <table>
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
            <tr>
              <td>Total</td>
              <td className="num">{report.totals.truckCount}</td>
              <td className="num">{fmtTons(report.totals.totalBridgeTons)}</td>
              <td className="num">100.0%</td>
            </tr>
          </tbody>
        </table>

        <h2>3. By size within each city (t)</h2>
        <table>
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
                    {row.sizeTons[col.key] != null ? fmtTons(row.sizeTons[col.key]) : "-"}
                  </td>
                ))}
                <td className="num">{fmtTons(row.totalTons)}</td>
              </tr>
            ))}
            <tr>
              <td>Total</td>
              {report.sizeColumns.map((col) => (
                <td key={col.key} className="num">
                  {fmtTons(report.citySizeColumnTotals[col.key])}
                </td>
              ))}
              <td className="num">{fmtTons(report.totals.totalInternalTons)}</td>
            </tr>
          </tbody>
        </table>

        <p className="pagefoot">-- 1 of 1 --</p>
      </div>
  );

  return (
    <>
      <style>{PRINT_STYLE}</style>
      {mounted ? createPortal(content, document.body) : null}
    </>
  );
}
