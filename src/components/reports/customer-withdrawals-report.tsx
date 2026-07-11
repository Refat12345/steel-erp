"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
    </div>
  );
}
