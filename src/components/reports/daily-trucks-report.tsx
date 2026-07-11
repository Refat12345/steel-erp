"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  BarChart3,
  Boxes,
  CalendarDays,
  Download,
  FileSpreadsheet,
  Layers,
  Loader2,
  Printer,
  RefreshCw,
  Truck,
} from "lucide-react";
import { sessionHasPermission } from "@/lib/client-permissions";
import { formatDateTime } from "@/lib/date-format";
import { formatDurationCompactEn } from "@/lib/format-duration";
import {
  TRUCK_STATUS_EN,
  gradeLabelEn,
  productFilterLabelEn,
  tonnageNoteEn,
  toEnglishCity,
  toEnglishSize,
} from "@/lib/en-labels";
import { defaultOperationalDateInput } from "@/lib/operational-day";
import { exportDailyTrucksExcel } from "@/lib/export/daily-trucks-excel";
import type { DailyTrucksReport, DailyTruckRow } from "@/lib/services/report.service";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

const STATUS_BADGE: Record<
  DailyTruckRow["tonnageStatus"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  included: "secondary",
  excluded_late_close: "outline",
  excluded_cancelled: "destructive",
  excluded_open: "default",
};

const PRODUCT_FILTER_OPTIONS = [
  { value: "FIRST", label: "First grade" },
  { value: "SECOND", label: "Second grade" },
  { value: "SHORTBAR", label: "Short bars" },
  { value: "SCRAP", label: "Scrap" },
  { value: "BILLET_WIRE", label: "Billet tying wire" },
  { value: "REBAR_UNDER_70CM", label: "Rebar under 70 cm" },
  { value: "BILLET_SCRAP_10M", label: "Billet scrap 10m" },
  { value: "SCRAP_50CM_1M", label: "Scrap 50 cm to 1 m" },
] as const;

function formatTons(value: number | null): string {
  if (value == null) return "—";
  return value.toFixed(3);
}

function formatBundles(value: number | null): string {
  if (value == null) return "—";
  return String(value);
}

function formatNullableDateTime(iso: string | null): string {
  if (!iso) return "—";
  return formatDateTime(iso);
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

export function DailyTrucksReportView() {
  const { data: session, status } = useSession();
  const canView = sessionHasPermission(session, "report.daily_trucks");

  const [operationalDate, setOperationalDate] = useState(() =>
    defaultOperationalDateInput(),
  );
  const [customerId, setCustomerId] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [report, setReport] = useState<DailyTrucksReport | null>(null);
  const [includeDetails, setIncludeDetails] = useState(false);

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
      const params = new URLSearchParams({ date: operationalDate });
      if (customerId !== "all") params.set("customerId", customerId);
      if (productFilter !== "all") params.set("product", productFilter);
      const res = await fetch(`/api/reports/daily-trucks?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json.error ?? "Failed to load the report");
        setReport(null);
        return;
      }
      setReport(json.data as DailyTrucksReport);
    } catch {
      toast.error("Failed to load the report");
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, [operationalDate, customerId, productFilter]);

  useEffect(() => {
    if (status === "authenticated" && canView) {
      void fetchReport();
    }
  }, [canView, fetchReport, status]);

  const hasExportableReport = !!report && report.rows.length > 0;

  const handleExportExcel = useCallback(() => {
    if (!report) return;
    try {
      exportDailyTrucksExcel(report, { includeDetails });
    } catch {
      toast.error("Failed to export the Excel file");
    }
  }, [report, includeDetails]);

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
          <BarChart3 className="h-5 w-5" style={{ color: "oklch(0.650 0.140 30)" }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">Daily Trucks Report</h1>
          <p className="text-sm text-muted-foreground">
            Operational day 08:00 to 08:00 (Asia/Damascus)
          </p>
          {report ? (
            <p className="text-xs text-muted-foreground mt-1">{report.windowLabelAr}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 min-w-0">
        <div className="space-y-1.5 min-w-[10rem]">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            Operational date
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
            <DropdownMenuCheckboxItem
              checked={includeDetails}
              onCheckedChange={(checked) => setIncludeDetails(checked === true)}
              closeOnClick={false}
            >
              Include per-truck size details
            </DropdownMenuCheckboxItem>
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
          {(() => {
            const canViewSensitiveTonnage = report.permissions.canViewSensitiveTonnage;
            const rowColSpan = canViewSensitiveTonnage ? 14 : 12;
            return (
              <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 min-w-0">
            <SummaryCard label="Registered" value={report.summary.registered} />
            <SummaryCard label="Completed" value={report.summary.completed} />
            <SummaryCard label="Cancelled" value={report.summary.cancelled} />
            <SummaryCard label="Open" value={report.summary.open} />
            <SummaryCard
              label="Bridge total"
              value={formatTons(report.summary.totalBridgeTons)}
              sub="t"
            />
            {canViewSensitiveTonnage ? (
              <>
                <SummaryCard
                  label="Internal total"
                  value={formatTons(report.summary.totalInternalTons)}
                  sub="t"
                />
                <SummaryCard
                  label="Discrepancy total"
                  value={formatTons(report.summary.totalDiscrepancyTons)}
                  sub="t"
                />
              </>
            ) : null}
          </div>

          {report.filters.customerName ? (
            <p className="text-sm text-muted-foreground">
              Customer filter: <span className="font-medium">{report.filters.customerName}</span>
            </p>
          ) : null}
          {report.filters.productFilter ? (
            <p className="text-sm text-muted-foreground">
              Product filter:{" "}
              <span className="font-medium">
                {productFilterLabelEn(report.filters.productFilter)}
              </span>
              {" · "}
              Shows bridge tons for matching rounds only; mixed visits may appear in
              more than one product filter.
            </p>
          ) : null}

          <Card className="shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div>
                <h2 className="text-base font-semibold">Totals by size</h2>
                <p className="text-xs text-muted-foreground">
                  Computed from internal weigh-session weights of trucks completed within the operational day
                </p>
              </div>
              <div className="rounded-lg border overflow-x-auto min-w-0">
                <Table dir="ltr" className="min-w-[560px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Size</TableHead>
                      <TableHead className="text-right">Internal total</TableHead>
                      <TableHead className="text-right">Bundles</TableHead>
                      <TableHead className="text-right">Trucks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.sizeTotals.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-center py-8 text-muted-foreground"
                        >
                          No internal weights grouped by size for this day
                        </TableCell>
                      </TableRow>
                    ) : (
                      report.sizeTotals.map((sizeTotal) => (
                        <TableRow key={sizeTotal.sizeId ?? "none"}>
                          <TableCell className="font-medium">
                            {toEnglishSize(sizeTotal.displayName)}
                          </TableCell>
                          <TableCell className="font-mono tabular-nums text-right">
                            {formatTons(sizeTotal.totalTons)}
                          </TableCell>
                          <TableCell className="font-mono tabular-nums text-right">
                            {formatBundles(sizeTotal.totalBundles)}
                          </TableCell>
                          <TableCell className="font-mono tabular-nums text-right">
                            {sizeTotal.truckCount}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="rounded-lg border overflow-x-auto min-w-0">
            <Table dir="ltr" className={canViewSensitiveTonnage ? "min-w-[1080px]" : "min-w-[920px]"}>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-center">#</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Sales order</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Internal loading time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Bridge</TableHead>
                  {canViewSensitiveTonnage ? (
                    <>
                      <TableHead className="text-right">Internal</TableHead>
                      <TableHead className="text-right">Discrepancy</TableHead>
                    </>
                  ) : null}
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={rowColSpan}
                      className="text-center py-10 text-muted-foreground"
                    >
                      No trucks registered on this operational day
                    </TableCell>
                  </TableRow>
                ) : (
                  report.rows.map((row, index) => (
                    <TableRow
                      key={row.id}
                      className={
                        row.tonnageStatus === "excluded_cancelled"
                          ? "bg-destructive/5"
                          : undefined
                      }
                    >
                      <TableCell className="text-center tabular-nums">{index + 1}</TableCell>
                      <TableCell className="font-mono font-medium">{row.plateNumber}</TableCell>
                      <TableCell>{row.driverName}</TableCell>
                      <TableCell>
                        {row.customer ? (
                          <span className="truncate block max-w-[8rem] sm:max-w-none">
                            {row.customer.fullName}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>{toEnglishCity(row.destination?.name)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.salesOrderNumber ?? "—"}
                      </TableCell>
                      <TableCell>{gradeLabelEn(row.grade)}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatNullableDateTime(row.createdAt)}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums whitespace-nowrap">
                        {formatDurationCompactEn(row.internalLoadingMs)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE[row.tonnageStatus]}>
                          {TRUCK_STATUS_EN[row.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono tabular-nums text-right">
                        {formatTons(row.bridgeTons)}
                      </TableCell>
                      {canViewSensitiveTonnage ? (
                        <>
                          <TableCell className="font-mono tabular-nums text-right">
                            {formatTons(row.internalTons)}
                          </TableCell>
                          <TableCell
                            className={`font-mono tabular-nums text-right ${
                              row.discrepancyWarning ? "text-red-600 font-semibold" : ""
                            }`}
                          >
                            {formatTons(row.discrepancyTons)}
                          </TableCell>
                        </>
                      ) : null}
                      <TableCell className="text-xs text-muted-foreground max-w-[10rem]">
                        {tonnageNoteEn(
                          row.tonnageStatus,
                          row.cancelReason,
                          row.isPartialVisit,
                        ) ?? "—"}
                        {row.rounds.length > 0 ? (
                          <div className="mt-1 space-y-0.5">
                            {row.rounds.map((r) => (
                              <div
                                key={r.roundNumber}
                                className="font-mono tabular-nums whitespace-nowrap"
                              >
                                R{r.roundNumber}
                                {r.grade ? ` (${gradeLabelEn(r.grade)})` : ""}:{" "}
                                {formatTons(r.netTons)} t
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
              </>
            );
          })()}
        </>
      ) : null}

      {report ? (
        <DailyTrucksPrintable report={report} includeDetails={includeDetails} />
      ) : null}
    </div>
  );
}

const PRINT_STYLE = `
@media screen {
  #daily-trucks-print { display: none; }
}
@media print {
  body * { visibility: hidden; }
  #daily-trucks-print, #daily-trucks-print * { visibility: visible; }
  #daily-trucks-print {
    display: block;
    position: absolute;
    top: 0;
    inset-inline-start: 0;
    width: 100%;
    padding: 12px;
    font-size: 12px;
    color: #000;
  }
  #daily-trucks-print table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  #daily-trucks-print th, #daily-trucks-print td {
    border: 1px solid #999;
    padding: 4px 6px;
    text-align: left;
  }
  #daily-trucks-print thead { display: table-header-group; }
  #daily-trucks-print tr { break-inside: avoid; }
  #daily-trucks-print h1 { font-size: 16px; margin: 0 0 4px; }
  #daily-trucks-print h2 { font-size: 13px; margin: 12px 0 4px; }
  #daily-trucks-print .num { text-align: right; font-variant-numeric: tabular-nums; }
  #daily-trucks-print .meta { font-size: 11px; color: #333; margin: 2px 0; }
  #daily-trucks-print .sizes { font-size: 11px; color: #333; }
}
`;

function DailyTrucksPrintable({
  report,
  includeDetails,
}: {
  report: DailyTrucksReport;
  includeDetails: boolean;
}) {
  const canSensitive = report.permissions.canViewSensitiveTonnage;
  return (
    <>
      <style>{PRINT_STYLE}</style>
      <div id="daily-trucks-print" dir="ltr">
        <h1>Daily Trucks Report</h1>
        <p className="meta">Operational day: {report.operationalDate}</p>
        <p className="meta">{report.windowLabelAr}</p>
        {report.filters.customerName ? (
          <p className="meta">Customer filter: {report.filters.customerName}</p>
        ) : null}
        {report.filters.productFilter ? (
          <p className="meta">
            Product filter: {productFilterLabelEn(report.filters.productFilter)}
          </p>
        ) : null}

        <h2>Summary</h2>
        <table>
          <tbody>
            <tr>
              <th>Registered</th>
              <td className="num">{report.summary.registered}</td>
              <th>Completed</th>
              <td className="num">{report.summary.completed}</td>
              <th>Cancelled</th>
              <td className="num">{report.summary.cancelled}</td>
              <th>Open</th>
              <td className="num">{report.summary.open}</td>
            </tr>
            <tr>
              <th>Bridge total (t)</th>
              <td className="num">{formatTons(report.summary.totalBridgeTons)}</td>
              {canSensitive ? (
                <>
                  <th>Internal total (t)</th>
                  <td className="num">{formatTons(report.summary.totalInternalTons)}</td>
                  <th>Discrepancy total (t)</th>
                  <td className="num">{formatTons(report.summary.totalDiscrepancyTons)}</td>
                </>
              ) : null}
            </tr>
          </tbody>
        </table>

        <h2>Totals by size</h2>
        <table>
          <thead>
            <tr>
              <th>Size</th>
              <th className="num">Internal total (t)</th>
              <th className="num">Bundles</th>
              <th className="num">Trucks</th>
            </tr>
          </thead>
          <tbody>
            {report.sizeTotals.length === 0 ? (
              <tr>
                <td colSpan={4}>No data</td>
              </tr>
            ) : (
              report.sizeTotals.map((sizeTotal) => (
                <tr key={sizeTotal.sizeId ?? "none"}>
                  <td>{toEnglishSize(sizeTotal.displayName)}</td>
                  <td className="num">{formatTons(sizeTotal.totalTons)}</td>
                  <td className="num">{formatBundles(sizeTotal.totalBundles)}</td>
                  <td className="num">{sizeTotal.truckCount}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <h2>Trucks</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Plate</th>
              <th>Driver</th>
              <th>Customer</th>
              <th>Destination</th>
              <th>Sales order</th>
              <th>Grade</th>
              <th>Status</th>
              <th className="num">Bridge</th>
              {canSensitive ? (
                <>
                  <th className="num">Internal</th>
                  <th className="num">Discrepancy</th>
                </>
              ) : null}
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={canSensitive ? 12 : 10}>No trucks</td>
              </tr>
            ) : (
              report.rows.map((row, index) => (
                <tr key={row.id}>
                  <td className="num">{index + 1}</td>
                  <td>{row.plateNumber}</td>
                  <td>{row.driverName}</td>
                  <td>{row.customer?.fullName ?? "—"}</td>
                  <td>{toEnglishCity(row.destination?.name)}</td>
                  <td>{row.salesOrderNumber ?? "—"}</td>
                  <td>{gradeLabelEn(row.grade)}</td>
                  <td>{TRUCK_STATUS_EN[row.status]}</td>
                  <td className="num">{formatTons(row.bridgeTons)}</td>
                  {canSensitive ? (
                    <>
                      <td className="num">{formatTons(row.internalTons)}</td>
                      <td className="num">{formatTons(row.discrepancyTons)}</td>
                    </>
                  ) : null}
                  <td>
                    {tonnageNoteEn(
                      row.tonnageStatus,
                      row.cancelReason,
                      row.isPartialVisit,
                    ) ?? "—"}
                    {includeDetails && row.sizeBreakdown.length > 0 ? (
                      <div className="sizes">
                        {row.sizeBreakdown
                          .map(
                            (item) =>
                              `${toEnglishSize(item.displayName)}: ${formatTons(item.weightTons)} t${
                                item.bundleCount != null
                                  ? ` (${item.bundleCount} bundles)`
                                  : ""
                              }`,
                          )
                          .join(", ")}
                      </div>
                    ) : null}
                    {includeDetails && row.rounds.length > 0 ? (
                      <div className="sizes">
                        {row.rounds
                          .map(
                            (r) =>
                              `Round ${r.roundNumber}${
                                r.grade ? ` (${gradeLabelEn(r.grade)})` : ""
                              }: ${formatTons(r.netTons)} t`,
                          )
                          .join(", ")}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function ReportsIndexView() {
  const { data: session } = useSession();
  const canDailyTrucks = sessionHasPermission(session, "report.daily_trucks");
  const canReports = sessionHasPermission(session, "reports.view");

  return (
    <div dir="ltr" className="flex-1 p-4 sm:p-6 space-y-6 min-w-0 max-w-full text-left">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "oklch(0.650 0.140 30 / 12%)",
            boxShadow: "inset 0 0 0 1px oklch(0.650 0.140 30 / 25%)",
          }}
        >
          <BarChart3 className="h-5 w-5" style={{ color: "oklch(0.650 0.140 30)" }} />
        </div>
        <div>
          <h1 className="text-xl font-bold">Reports</h1>
          <p className="text-sm text-muted-foreground">Operations and trucks reports</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
        {canDailyTrucks ? (
          <Link href="/reports/daily-trucks" className="block min-w-0">
            <Card className="h-full shadow-sm transition-colors hover:bg-muted/40">
              <CardContent className="flex items-start gap-4 p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Truck className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold">Daily Trucks Report</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Operational-day trucks (8am→8am) — bridge weight and loading time
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ) : null}
        {canDailyTrucks ? (
          <Link href="/reports/daily-loading-summary" className="block min-w-0">
            <Card className="h-full shadow-sm transition-colors hover:bg-muted/40">
              <CardContent className="flex items-start gap-4 p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Layers className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold">Daily Loading Summary</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Grouped by customer, city, and size — with shares
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ) : null}
        {canDailyTrucks ? (
          <Link href="/reports/customer-withdrawals" className="block min-w-0">
            <Card className="h-full shadow-sm transition-colors hover:bg-muted/40">
              <CardContent className="flex items-start gap-4 p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Boxes className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold">Customer Withdrawals by Size</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Bundles and weight withdrawn per customer and size over a date range
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ) : null}
        {canReports ? (
          <Link href="/reports/billet-balance" className="block min-w-0">
            <Card className="h-full shadow-sm transition-colors hover:bg-muted/40">
              <CardContent className="flex items-start gap-4 p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Boxes className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold">Billet Receiving Balance</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Cumulative supplier balance for received and remaining billet
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
