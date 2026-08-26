"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarDays,
  Loader2,
  MapPinned,
  Printer,
  RefreshCw,
} from "lucide-react";
import { sessionHasPermission } from "@/lib/client-permissions";
import { formatDateTime } from "@/lib/date-format";
import { toEnglishCity, toEnglishSize } from "@/lib/en-labels";
import { BRAND } from "@/lib/brand";
import { offeredSteelClassifications } from "@/lib/steel-classification-default";
import {
  computeA4LandscapePrintFitScale,
  SCALE_CARD_PRINT_HEIGHT_FUDGE,
} from "@/lib/scale-card-print-fit";
import type { GovernorateWithdrawalsReport } from "@/lib/services/report.service";
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

interface DestinationOption {
  id: number;
  name: string;
}

interface SizeOption {
  id: number;
  code: string;
  displayName: string;
}

interface ClassificationOption {
  id: number;
  code: string;
  /** Latin technical code (B500B / B400DWR) — identical in both languages. */
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

function formatShare(value: number): string {
  return `${value.toFixed(1)}%`;
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

export function GovernorateWithdrawalsReportView({
  analyticsStartDate,
}: {
  analyticsStartDate: string | null;
}) {
  const { data: session, status } = useSession();
  const canView = sessionHasPermission(session, "report.daily_trucks");

  const [fromDate, setFromDate] = useState(() => {
    const monthStart = firstDayOfCurrentMonthInput();
    return analyticsStartDate && analyticsStartDate > monthStart
      ? analyticsStartDate
      : monthStart;
  });
  const [toDate, setToDate] = useState(() => todayInput());
  const [customerId, setCustomerId] = useState<string>("all");
  const [destinationId, setDestinationId] = useState<string>("all");
  const [sizeId, setSizeId] = useState<string>("all");
  const [classificationId, setClassificationId] = useState<string>("all");

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [destinations, setDestinations] = useState<DestinationOption[]>([]);
  const [loadingDestinations, setLoadingDestinations] = useState(true);
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [loadingSizes, setLoadingSizes] = useState(true);
  const [classifications, setClassifications] = useState<ClassificationOption[]>([]);

  const [loadingReport, setLoadingReport] = useState(false);
  const [report, setReport] = useState<GovernorateWithdrawalsReport | null>(null);

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
      setLoadingDestinations(true);
      try {
        const res = await fetch("/api/destinations?limit=100");
        const json = await res.json();
        if (!cancelled && json.success && Array.isArray(json.data)) {
          setDestinations(json.data);
        }
      } catch {
        if (!cancelled) toast.error("Failed to load destinations");
      } finally {
        if (!cancelled) setLoadingDestinations(false);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/steel-classifications");
        const json = await res.json();
        if (!cancelled && json.success && Array.isArray(json.data)) {
          setClassifications(offeredSteelClassifications(json.data));
        }
      } catch {
        // Non-critical: the filter simply stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const destinationSelectItems = useMemo(
    () => [
      { value: "all", label: "All governorates" },
      ...destinations.map((d) => ({
        value: String(d.id),
        label: toEnglishCity(d.name),
      })),
    ],
    [destinations],
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

  const classificationSelectItems = useMemo(
    () => [
      { value: "all", label: "All classifications" },
      ...classifications.map((c) => ({
        value: String(c.id),
        label: c.displayName,
      })),
    ],
    [classifications],
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
      if (destinationId !== "all") params.set("destinationId", destinationId);
      if (sizeId !== "all") params.set("sizeId", sizeId);
      if (classificationId !== "all")
        params.set("classificationId", classificationId);
      const res = await fetch(
        `/api/reports/governorate-withdrawals?${params.toString()}`,
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json.error ?? "Failed to load the report");
        setReport(null);
        return;
      }
      setReport(json.data as GovernorateWithdrawalsReport);
    } catch {
      toast.error("Failed to load the report");
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, [customerId, destinationId, fromDate, toDate, sizeId, classificationId]);

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

  // Show the per-size totals when sizes vary — or when one size splits into
  // several classification lines.
  const showSizeTotals =
    report != null &&
    (report.filters.sizeId == null || report.sizeTotals.length > 1);

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
          <MapPinned className="h-5 w-5" style={{ color: "oklch(0.650 0.140 30)" }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">Governorate Withdrawals</h1>
          <p className="text-sm text-muted-foreground">
            Internal weigh tons and bundles withdrawn per governorate over a date
            range — completed trucks only
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 min-w-0">
        <div className="space-y-1.5 min-w-[12rem] flex-1 sm:max-w-xs">
          <label className="text-xs font-medium text-muted-foreground">
            Customer
          </label>
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

        <div className="space-y-1.5 min-w-[12rem] flex-1 sm:max-w-xs">
          <label className="text-xs font-medium text-muted-foreground">
            Governorate
          </label>
          <Select
            items={destinationSelectItems}
            value={destinationId}
            onValueChange={(v) => setDestinationId(v ?? "all")}
            disabled={loadingDestinations}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All governorates" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All governorates</SelectItem>
              {destinations.map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>
                  {toEnglishCity(d.name)}
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

        {classifications.length > 0 && (
          <div className="space-y-1.5 min-w-[10rem]">
            <label className="text-xs font-medium text-muted-foreground">
              Classification
            </label>
            <Select
              items={classificationSelectItems}
              value={classificationId}
              onValueChange={(v) => setClassificationId(v ?? "all")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All classifications" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All classifications</SelectItem>
                {classifications.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5 min-w-[10rem]">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            From
          </label>
          <Input
            type="date"
            value={fromDate}
            min={analyticsStartDate ?? undefined}
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
            min={analyticsStartDate ?? undefined}
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
          <span className="ms-2">Show report</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={handlePrint}
          disabled={!report || report.rows.length === 0}
        >
          <Printer className="h-4 w-4" />
          <span className="ms-2">Print / PDF</span>
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
            {" · "}
            <span className="font-medium text-foreground">
              {report.filters.destinationName
                ? toEnglishCity(report.filters.destinationName)
                : "All governorates"}
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
            {report.filters.classificationDisplayName ? (
              <>
                {" · "}
                <span className="font-medium text-foreground">
                  {report.filters.classificationDisplayName}
                </span>
              </>
            ) : null}
            {" · "}
            {report.fromDate} → {report.toDate}
            <span className="text-xs">
              {" "}
              (08:00 {report.fromDate} to 08:00 the day after {report.toDate},
              Asia/Damascus)
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 min-w-0 max-w-3xl">
            <SummaryCard
              label="Total weight"
              value={formatTons(report.totals.totalTons)}
              sub="t"
            />
            <SummaryCard
              label="Total bundles"
              value={formatBundles(report.totals.totalBundles)}
              sub={
                report.totals.totalBundles == null
                  ? "Some entries have no bundle count"
                  : undefined
              }
            />
            <SummaryCard label="Trucks" value={report.totals.truckCount} />
            <SummaryCard
              label="Governorates"
              value={report.totals.governorateCount}
            />
          </div>

          <div className="space-y-2 min-w-0">
            <h2 className="text-sm font-semibold">By governorate</h2>
            {report.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No withdrawals found for the selected filters
              </p>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <Table dir="ltr" className="min-w-[560px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Governorate</TableHead>
                      <TableHead className="text-right">Trucks</TableHead>
                      <TableHead className="text-right">Bundles</TableHead>
                      <TableHead className="text-right">Weight (t)</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.map((row, index) => (
                      <TableRow key={row.destinationId ?? "none"}>
                        <TableCell className="text-muted-foreground">
                          {index + 1}
                        </TableCell>
                        <TableCell className="font-medium">
                          {toEnglishCity(row.destinationName)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.truckCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBundles(row.totalBundles)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTons(row.totalTons)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatShare(row.sharePct)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableCell />
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {report.totals.truckCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatBundles(report.totals.totalBundles)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatTons(report.totals.totalTons)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {report.rows.length > 0 ? "100.0%" : "—"}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {showSizeTotals && report.sizeTotals.length > 0 ? (
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
                      <TableRow
                        key={`${s.sizeId ?? "none"}|${s.classificationId ?? "none"}`}
                      >
                        <TableCell className="font-medium">
                          {toEnglishSize(s.displayName, s.code)}
                          {s.classificationName ? (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {s.classificationName}
                            </span>
                          ) : null}
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
        </>
      ) : (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Select the filters and date range, then press &quot;Show report&quot;
        </p>
      )}

      {report ? <GovernorateWithdrawalsPrintable report={report} /> : null}
    </div>
  );
}

const PRINT_STYLE = `
#governorate-withdrawals-print {
  color: #000;
  font-family: Calibri, Arial, sans-serif;
  font-size: 10px;
  line-height: 1.2;
  background: #fff;
  transform-origin: top left;
}
#governorate-withdrawals-print .print-title {
  font-size: 13px;
  font-weight: 700;
  margin: 0 0 2px;
}
#governorate-withdrawals-print .section-title {
  color: #2b3f55;
  font-size: 12px;
  font-weight: 700;
  margin: 12px 0 7px 6px;
}
#governorate-withdrawals-print table {
  border: 1px solid #c7d1df;
  border-collapse: collapse;
  margin-bottom: 11px;
  table-layout: fixed;
}
#governorate-withdrawals-print .narrow-table {
  width: 70%;
  margin-left: auto;
  margin-right: auto;
}
#governorate-withdrawals-print th, #governorate-withdrawals-print td {
  border: 1px solid #c7d1df;
  padding: 4px 7px;
  text-align: left;
  word-break: break-word;
  overflow-wrap: anywhere;
}
#governorate-withdrawals-print th {
  background: #1f3864;
  color: #fff;
  font-weight: 700;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#governorate-withdrawals-print tbody tr:nth-child(even):not(.total-row) td {
  background: #f1f4fa;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#governorate-withdrawals-print .total-row td {
  background: #dbe5f3;
  font-weight: 700;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#governorate-withdrawals-print thead { display: table-header-group; }
#governorate-withdrawals-print tr { break-inside: avoid; }
#governorate-withdrawals-print .num { text-align: right; font-variant-numeric: tabular-nums; }
#governorate-withdrawals-print .headline { font-size: 10px; color: #222; margin: 0 0 4px; }
#governorate-withdrawals-print .pagefoot { text-align: center; font-size: 10px; color: #555; margin-top: 14px; }

@media screen {
  #governorate-withdrawals-print { display: none; }
  #governorate-withdrawals-print.is-measuring {
    display: block;
    position: fixed;
    left: -10000px;
    top: 0;
    width: 277mm;
    background: #fff;
  }
}
@media print {
  @page { size: landscape; margin: 10mm; }
  html, body { background: #fff !important; }
  body > *:not(#governorate-withdrawals-print) { display: none !important; }
  #governorate-withdrawals-print {
    display: block;
    width: 100%;
  }
}
`;

const MIN_PRINT_FIT_SCALE = 0.6;

function buildHeaderLine(report: GovernorateWithdrawalsReport): string {
  return [
    `Period: ${report.fromDate} → ${report.toDate}`,
    `Trucks: ${report.totals.truckCount}`,
    `Total: ${formatBundles(report.totals.totalBundles)} bundles / ${formatTons(report.totals.totalTons)} t`,
    `generated ${formatDateTime(report.generatedAt)}`,
  ].join(" | ");
}

function GovernorateWithdrawalsPrintable({
  report,
}: {
  report: GovernorateWithdrawalsReport;
}) {
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
    el.classList.add("is-measuring");
    const width = el.scrollWidth;
    const height = Math.max(el.scrollHeight, el.getBoundingClientRect().height);
    el.classList.remove("is-measuring");

    const scale = computeA4LandscapePrintFitScale(
      width,
      height * SCALE_CARD_PRINT_HEIGHT_FUDGE,
    );

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
    <div id="governorate-withdrawals-print" dir="ltr" ref={printRef}>
      <h1 className="print-title">
        {BRAND.name} — Governorate Withdrawals
      </h1>
      <p className="headline">{buildHeaderLine(report)}</p>
      <p className="headline">
        Customer: {report.filters.customerName ?? "All customers"}
        {" | "}
        Governorate:{" "}
        {report.filters.destinationName
          ? toEnglishCity(report.filters.destinationName)
          : "All governorates"}
        {" | "}
        Size:{" "}
        {report.filters.sizeDisplayName
          ? toEnglishSize(report.filters.sizeDisplayName)
          : "All sizes"}
        {report.filters.classificationDisplayName
          ? ` | Classification: ${report.filters.classificationDisplayName}`
          : ""}
      </p>

      <h2 className="section-title">By governorate</h2>
      <table className="narrow-table">
        <thead>
          <tr>
            <th>Governorate</th>
            <th className="num">Trucks</th>
            <th className="num">Bundles</th>
            <th className="num">Weight (t)</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.destinationId ?? "none"}>
              <td>{toEnglishCity(row.destinationName)}</td>
              <td className="num">{row.truckCount}</td>
              <td className="num">{formatBundles(row.totalBundles)}</td>
              <td className="num">{formatTons(row.totalTons)}</td>
              <td className="num">{formatShare(row.sharePct)}</td>
            </tr>
          ))}
          <tr className="total-row">
            <td>Total</td>
            <td className="num">{report.totals.truckCount}</td>
            <td className="num">{formatBundles(report.totals.totalBundles)}</td>
            <td className="num">{formatTons(report.totals.totalTons)}</td>
            <td className="num">{report.rows.length > 0 ? "100.0%" : "—"}</td>
          </tr>
        </tbody>
      </table>

      {(report.filters.sizeId == null || report.sizeTotals.length > 1) &&
      report.sizeTotals.length > 0 ? (
        <>
          <h2 className="section-title">Totals by size</h2>
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
                <tr key={`${s.sizeId ?? "none"}|${s.classificationId ?? "none"}`}>
                  <td>
                    {toEnglishSize(s.displayName, s.code)}
                    {s.classificationName ? ` ${s.classificationName}` : ""}
                  </td>
                  <td className="num">{formatBundles(s.totalBundles)}</td>
                  <td className="num">{formatTons(s.totalTons)}</td>
                  <td className="num">{s.truckCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
