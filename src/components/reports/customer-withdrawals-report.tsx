"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Boxes,
  CalendarDays,
  Loader2,
  Printer,
  RefreshCw,
} from "lucide-react";
import { sessionHasPermission } from "@/lib/client-permissions";
import { formatDateTime } from "@/lib/date-format";
import { toEnglishCity, toEnglishSize } from "@/lib/en-labels";
import { BRAND } from "@/lib/brand";
import {
  computeA4LandscapePrintFitScale,
  SCALE_CARD_PRINT_HEIGHT_FUDGE,
} from "@/lib/scale-card-print-fit";
import type { CustomerWithdrawalsReport } from "@/lib/services/report.service";
import { Button } from "@/components/ui/button";
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

interface SizeOption {
  id: number;
  code: string;
  displayName: string;
}

function formatTons(value: number | null): string {
  if (value == null) return "—";
  return value.toFixed(3);
}

function formatBundles(value: number | null): string {
  if (value == null) return "—";
  return String(value);
}

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

export function CustomerWithdrawalsReportView() {
  const { data: session, status } = useSession();
  const canView = sessionHasPermission(session, "report.daily_trucks");

  const [fromDate, setFromDate] = useState(() => firstDayOfCurrentMonthInput());
  const [toDate, setToDate] = useState(() => todayInput());
  const [customerId, setCustomerId] = useState<string>("all");
  const [sizeId, setSizeId] = useState<string>("all");

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [loadingSizes, setLoadingSizes] = useState(true);

  const [loadingReport, setLoadingReport] = useState(false);
  const [report, setReport] = useState<CustomerWithdrawalsReport | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingSizes(true);
      try {
        const res = await fetch("/api/sizes");
        const json = await res.json();
        if (!cancelled && json.success && Array.isArray(json.data)) {
          setSizes(json.data);
        }
      } catch {
        if (!cancelled) toast.error("Failed to load sizes");
      } finally {
        if (!cancelled) setLoadingSizes(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Lets Select.Value show the label; Base UI renders raw `value` without `items`. */
  const customerSelectItems = useMemo(
    () => [
      { value: "all", label: "All customers" },
      ...customers.map((c) => ({
        value: String(c.id),
        label: `${c.code} — ${c.fullName}`,
      })),
    ],
    [customers],
  );

  const sizeSelectItems = useMemo(
    () => [
      { value: "all", label: "All sizes" },
      ...sizes.map((s) => ({
        value: String(s.id),
        label: toEnglishSize(s.displayName, s.code),
      })),
    ],
    [sizes],
  );

  const fetchReport = useCallback(async () => {
    if (!fromDate || !toDate) {
      toast.error("Select the date range");
      return;
    }
    setLoadingReport(true);
    try {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      if (customerId !== "all") params.set("customerId", customerId);
      if (sizeId !== "all") params.set("sizeId", sizeId);
      const res = await fetch(
        `/api/reports/customer-withdrawals?${params.toString()}`,
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json.error ?? "Failed to load the report");
        setReport(null);
        return;
      }
      setReport(json.data as CustomerWithdrawalsReport);
    } catch {
      toast.error("Failed to load the report");
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, [customerId, fromDate, toDate, sizeId]);

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

  const showAllSizes = report != null && report.filters.sizeId == null;
  const showAllCustomers = report != null && report.filters.customerId == null;

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
          <Boxes className="h-5 w-5" style={{ color: "oklch(0.650 0.140 30)" }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">Customer Withdrawals by Size</h1>
          <p className="text-sm text-muted-foreground">
            Bundles and net weight withdrawn by a customer over a date range —
            completed trucks only
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 min-w-0">
        <div className="space-y-1.5 min-w-[12rem] flex-1 sm:max-w-xs">
          <label className="text-xs font-medium text-muted-foreground">Customer</label>
          <Select
            items={customerSelectItems}
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
          <label className="text-xs font-medium text-muted-foreground">Size</label>
          <Select
            items={sizeSelectItems}
            value={sizeId}
            onValueChange={(v) => setSizeId(v ?? "all")}
            disabled={loadingSizes}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All sizes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sizes</SelectItem>
              {sizes.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {toEnglishSize(s.displayName, s.code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 min-w-[10rem]">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            From
          </label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full min-w-[10rem]"
          />
        </div>

        <div className="space-y-1.5 min-w-[10rem]">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            To
          </label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full min-w-[10rem]"
          />
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
          onClick={handlePrint}
          disabled={!report || report.rows.length === 0}
        >
          <Printer className="h-4 w-4" />
          <span className="ml-2">Print / PDF</span>
        </Button>
      </div>

      {loadingReport && !report ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : report ? (
        <>
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {report.filters.customerName ?? "All customers"}
            </span>
            {report.filters.sizeDisplayName ? (
              <>
                {" · "}
                <span className="font-medium text-foreground">
                  {toEnglishSize(report.filters.sizeDisplayName)}
                </span>
              </>
            ) : (
              " · All sizes"
            )}
            {" · "}
            {report.fromDate} → {report.toDate}
            <span className="text-xs">
              {" "}
              (08:00 {report.fromDate} to 08:00 the day after {report.toDate},
              Asia/Damascus)
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 min-w-0 max-w-2xl">
            <SummaryCard
              label="Total bundles"
              value={formatBundles(report.totals.totalBundles)}
              sub={report.totals.totalBundles == null ? "Some entries have no bundle count" : undefined}
            />
            <SummaryCard
              label="Total weight"
              value={formatTons(report.totals.totalTons)}
              sub="t"
            />
            <SummaryCard label="Trucks" value={report.totals.truckCount} />
          </div>

          {showAllSizes && report.sizeTotals.length > 0 ? (
            <div className="space-y-2 min-w-0">
              <h2 className="text-sm font-semibold">Totals by size</h2>
              <div className="rounded-lg border overflow-x-auto">
                <Table dir="ltr" className="min-w-[520px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Size</TableHead>
                      <TableHead className="text-right">Bundles</TableHead>
                      <TableHead className="text-right">Weight (t)</TableHead>
                      <TableHead className="text-right">Trucks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.sizeTotals.map((s) => (
                      <TableRow key={s.sizeId ?? "none"}>
                        <TableCell className="font-medium">
                          {toEnglishSize(s.displayName, s.code)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBundles(s.totalBundles)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTons(s.totalTons)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.truckCount}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          <div className="space-y-2 min-w-0">
            <h2 className="text-sm font-semibold">Trucks</h2>
            {report.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No withdrawals found for the selected filters
              </p>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <Table dir="ltr" className={showAllCustomers ? "min-w-[880px]" : "min-w-[720px]"}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Completed at</TableHead>
                      <TableHead>Plate</TableHead>
                      <TableHead>Driver</TableHead>
                      {showAllCustomers ? <TableHead>Customer</TableHead> : null}
                      <TableHead>Destination</TableHead>
                      <TableHead>Sales order</TableHead>
                      <TableHead className="text-right">Bundles</TableHead>
                      <TableHead className="text-right">Weight (t)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.map((row, index) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-muted-foreground">
                          {index + 1}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDateTime(row.closedAt)}
                        </TableCell>
                        <TableCell className="font-medium">{row.plateNumber}</TableCell>
                        <TableCell>{row.driverName}</TableCell>
                        {showAllCustomers ? (
                          <TableCell>{row.customerName ?? "—"}</TableCell>
                        ) : null}
                        <TableCell>{toEnglishCity(row.destinationName)}</TableCell>
                        <TableCell>{row.salesOrderNumber ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBundles(row.bundleCount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTons(row.weightTons)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Select the filters and date range, then press &quot;Show report&quot;
        </p>
      )}

      {report ? <CustomerWithdrawalsPrintable report={report} /> : null}
    </div>
  );
}

/* Base typography is written OUTSIDE @media print so it also applies while the
   printable is measured off-screen — measurement must match the real print
   layout for the scale-to-fit math to be accurate. */
const PRINT_STYLE = `
#customer-withdrawals-print {
  color: #000;
  font-family: Calibri, Arial, sans-serif;
  font-size: 10px;
  line-height: 1.2;
  background: #fff;
  transform-origin: top left;
}
#customer-withdrawals-print .print-title {
  font-size: 13px;
  font-weight: 700;
  margin: 0 0 2px;
}
#customer-withdrawals-print .section-title {
  color: #2b3f55;
  font-size: 12px;
  font-weight: 700;
  margin: 12px 0 7px 6px;
}
#customer-withdrawals-print table {
  border: 1px solid #c7d1df;
  border-collapse: collapse;
  margin-bottom: 11px;
  table-layout: fixed;
}
#customer-withdrawals-print .narrow-table {
  width: 58%;
  margin-left: auto;
  margin-right: auto;
}
#customer-withdrawals-print .wide-table {
  width: 100%;
}
#customer-withdrawals-print th, #customer-withdrawals-print td {
  border: 1px solid #c7d1df;
  padding: 4px 7px;
  text-align: left;
  word-break: break-word;
  overflow-wrap: anywhere;
}
#customer-withdrawals-print th {
  background: #1f3864;
  color: #fff;
  font-weight: 700;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#customer-withdrawals-print tbody tr:nth-child(even):not(.total-row) td {
  background: #f1f4fa;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#customer-withdrawals-print .total-row td {
  background: #dbe5f3;
  font-weight: 700;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#customer-withdrawals-print thead { display: table-header-group; }
#customer-withdrawals-print tr { break-inside: avoid; }
#customer-withdrawals-print .num { text-align: right; font-variant-numeric: tabular-nums; }
#customer-withdrawals-print .headline { font-size: 10px; color: #222; margin: 0 0 4px; }
#customer-withdrawals-print .pagefoot { text-align: center; font-size: 10px; color: #555; margin-top: 14px; }

@media screen {
  /* Hidden on screen, except briefly while measuring: rendered off-canvas at
     the exact landscape printable width so its height matches the printout. */
  #customer-withdrawals-print { display: none; }
  #customer-withdrawals-print.is-measuring {
    display: block;
    position: fixed;
    left: -10000px;
    top: 0;
    width: 277mm;
    background: #fff;
  }
}
@media print {
  /* Landscape to fit the trucks table comfortably. */
  @page { size: landscape; margin: 10mm; }
  html, body { background: #fff !important; }
  /* The printable is portaled to <body>; hide everything else so the
     report prints from the top and paginates normally (no clipping). */
  body > *:not(#customer-withdrawals-print) { display: none !important; }
  #customer-withdrawals-print {
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

function buildHeaderLine(report: CustomerWithdrawalsReport): string {
  return [
    `Period: ${report.fromDate} → ${report.toDate}`,
    `Trucks: ${report.totals.truckCount}`,
    `Total: ${formatBundles(report.totals.totalBundles)} bundles / ${formatTons(report.totals.totalTons)} t`,
    `generated ${formatDateTime(report.generatedAt)}`,
  ].join(" | ");
}

function CustomerWithdrawalsPrintable({
  report,
}: {
  report: CustomerWithdrawalsReport;
}) {
  const printRef = useRef<HTMLDivElement>(null);
  const showAllSizes = report.filters.sizeId == null;
  const showAllCustomers = report.filters.customerId == null;

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
    <div id="customer-withdrawals-print" dir="ltr" ref={printRef}>
      <h1 className="print-title">
        {BRAND.name} — Customer Withdrawals by Size
      </h1>
      <p className="headline">{buildHeaderLine(report)}</p>
      <p className="headline">
        Customer: {report.filters.customerName ?? "All customers"}
        {" | "}
        Size:{" "}
        {report.filters.sizeDisplayName
          ? toEnglishSize(report.filters.sizeDisplayName)
          : "All sizes"}
      </p>

      {showAllSizes && report.sizeTotals.length > 0 ? (
        <>
          <h2 className="section-title">1. Totals by size</h2>
          <table className="narrow-table">
            <thead>
              <tr>
                <th>Size</th>
                <th className="num">Bundles</th>
                <th className="num">Weight (t)</th>
                <th className="num">Trucks</th>
              </tr>
            </thead>
            <tbody>
              {report.sizeTotals.map((s) => (
                <tr key={s.sizeId ?? "none"}>
                  <td>{toEnglishSize(s.displayName, s.code)}</td>
                  <td className="num">{formatBundles(s.totalBundles)}</td>
                  <td className="num">{formatTons(s.totalTons)}</td>
                  <td className="num">{s.truckCount}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td>Total</td>
                <td className="num">{formatBundles(report.totals.totalBundles)}</td>
                <td className="num">{formatTons(report.totals.totalTons)}</td>
                <td className="num">{report.totals.truckCount}</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}

      <h2 className="section-title">
        {showAllSizes && report.sizeTotals.length > 0 ? "2. Trucks" : "Trucks"}
      </h2>
      <table className="wide-table">
        <thead>
          <tr>
            <th style={{ width: "4%" }}>#</th>
            <th>Completed at</th>
            <th>Plate</th>
            <th>Driver</th>
            {showAllCustomers ? <th>Customer</th> : null}
            <th>Destination</th>
            <th>Sales order</th>
            <th className="num">Bundles</th>
            <th className="num">Weight (t)</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row, index) => (
            <tr key={row.id}>
              <td>{index + 1}</td>
              <td>{formatDateTime(row.closedAt)}</td>
              <td>{row.plateNumber}</td>
              <td>{row.driverName}</td>
              {showAllCustomers ? <td>{row.customerName ?? "-"}</td> : null}
              <td>{toEnglishCity(row.destinationName)}</td>
              <td>{row.salesOrderNumber ?? "-"}</td>
              <td className="num">{formatBundles(row.bundleCount)}</td>
              <td className="num">{formatTons(row.weightTons)}</td>
            </tr>
          ))}
          <tr className="total-row">
            <td colSpan={showAllCustomers ? 7 : 6}>Total</td>
            <td className="num">{formatBundles(report.totals.totalBundles)}</td>
            <td className="num">{formatTons(report.totals.totalTons)}</td>
          </tr>
        </tbody>
      </table>

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
