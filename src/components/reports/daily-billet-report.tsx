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
  Download,
  FileSpreadsheet,
  Loader2,
  Printer,
  RefreshCw,
} from "lucide-react";
import { sessionHasPermission } from "@/lib/client-permissions";
import { formatDateTime } from "@/lib/date-format";
import { BRAND } from "@/lib/brand";
import { exportDailyBilletExcel } from "@/lib/export/daily-billet-excel";
import { defaultOperationalDateInput } from "@/lib/operational-day";
import { REPORTS_PERMISSION } from "@/lib/rbac-policy";
import {
  computeA4LandscapePrintFitScale,
  SCALE_CARD_PRINT_HEIGHT_FUDGE,
} from "@/lib/scale-card-print-fit";
import type { BilletSupplierOption } from "@/lib/services/billet-contract.service";
import type { DailyBilletReport } from "@/lib/services/report.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function fmtTons(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function fmtPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function fmtLoadingDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
}

function buildHeaderLine(report: DailyBilletReport): string {
  return [
    `Receiving date: ${fmtLoadingDate(report.operationalDate)}`,
    `Receipts: ${report.summary.includedLoads}`,
    `Total net (قبان): ${fmtTons(report.summary.totalNetTons)} t`,
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

export function DailyBilletReportView() {
  const { data: session, status } = useSession();
  const canView = sessionHasPermission(session, REPORTS_PERMISSION);

  const [operationalDate, setOperationalDate] = useState(() =>
    defaultOperationalDateInput(),
  );
  const [suppliers, setSuppliers] = useState<BilletSupplierOption[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [supplierName, setSupplierName] = useState("all");
  const [contractNumber, setContractNumber] = useState("all");
  const [loadingReport, setLoadingReport] = useState(false);
  const [report, setReport] = useState<DailyBilletReport | null>(null);

  const selectedSupplier = useMemo(
    () =>
      supplierName === "all"
        ? null
        : (suppliers.find((s) => s.supplierName === supplierName) ?? null),
    [supplierName, suppliers],
  );

  const contractOptions = useMemo(() => {
    if (selectedSupplier) {
      return selectedSupplier.contracts.map((c) => ({
        contractNumber: c.contractNumber,
        label: c.contractNumber,
      }));
    }
    return suppliers.flatMap((s) =>
      s.contracts.map((c) => ({
        contractNumber: c.contractNumber,
        label: `${c.contractNumber} — ${s.supplierName}`,
      })),
    );
  }, [selectedSupplier, suppliers]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingSuppliers(true);
      try {
        const res = await fetch("/api/reports/billet-balance/suppliers");
        const json = await res.json();
        if (!cancelled && json.success && Array.isArray(json.data)) {
          setSuppliers(json.data);
        }
      } catch {
        if (!cancelled) toast.error("Failed to load suppliers");
      } finally {
        if (!cancelled) setLoadingSuppliers(false);
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
      if (supplierName !== "all") params.set("supplierName", supplierName);
      if (contractNumber !== "all") params.set("contractNumber", contractNumber);
      const res = await fetch(`/api/reports/daily-billet?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json.error ?? "Failed to load the report");
        setReport(null);
        return;
      }
      setReport(json.data as DailyBilletReport);
    } catch {
      toast.error("Failed to load the report");
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, [contractNumber, operationalDate, supplierName]);

  useEffect(() => {
    if (status === "authenticated" && canView) {
      void fetchReport();
    }
  }, [canView, fetchReport, status]);

  const hasExportableReport =
    !!report &&
    (report.summary.includedLoads > 0 || report.byContract.length > 0);

  function handleSupplierChange(value: string | null) {
    setSupplierName(value ?? "all");
    setContractNumber("all");
  }

  function handleExportExcel() {
    if (!report) return;
    try {
      exportDailyBilletExcel(report);
    } catch {
      toast.error("Failed to export the Excel file");
    }
  }

  function handlePrint() {
    if (report) window.print();
  }

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
          You do not have permission to view reports
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
          <Boxes className="h-5 w-5" style={{ color: "oklch(0.650 0.140 30)" }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">
            {BRAND.name} — Billet Receiving Summary
          </h1>
          <p className="text-sm text-muted-foreground">
            Operational day cutoff 08:00 (Asia/Damascus)
          </p>
          {report ? (
            <p className="text-xs text-muted-foreground mt-1">
              Receiving date: {fmtLoadingDate(report.operationalDate)} &middot;{" "}
              {report.windowLabel}
            </p>
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
            min={report?.analyticsStartDate ?? undefined}
            onChange={(e) => setOperationalDate(e.target.value)}
            className="w-full min-w-[10rem]"
          />
        </div>

        <div className="space-y-1.5 min-w-[12rem] flex-1 sm:max-w-xs">
          <label className="text-xs font-medium text-muted-foreground">Supplier</label>
          <Select
            value={supplierName}
            onValueChange={handleSupplierChange}
            disabled={loadingSuppliers}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All suppliers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All suppliers</SelectItem>
              {suppliers.map((supplier) => (
                <SelectItem key={supplier.supplierName} value={supplier.supplierName}>
                  {supplier.supplierName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 min-w-[12rem] flex-1 sm:max-w-xs">
          <label className="text-xs font-medium text-muted-foreground">Contract</label>
          <Select
            value={contractNumber}
            onValueChange={(v) => setContractNumber(v ?? "all")}
            disabled={loadingSuppliers}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All contracts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All contracts</SelectItem>
              {contractOptions.map((contract) => (
                <SelectItem key={contract.contractNumber} value={contract.contractNumber}>
                  {contract.label}
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
            setSupplierName("all");
            setContractNumber("all");
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
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Export report</DropdownMenuLabel>
            </DropdownMenuGroup>
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
            const showRemaining =
              !!report.filters.supplierName || !!report.filters.contractNumber;
            return (
              <>
          <div
            className={`grid grid-cols-2 sm:grid-cols-3 gap-3 min-w-0 ${
              showRemaining ? "lg:grid-cols-5" : "lg:grid-cols-4"
            }`}
          >
            <SummaryCard label="Included receipts" value={report.summary.includedLoads} />
            <SummaryCard
              label="Net total (قبان)"
              value={fmtTons(report.summary.totalNetTons)}
              sub="t"
            />
            {showRemaining ? (
            <SummaryCard
                label={
                  report.filters.contractNumber
                    ? "Remaining on contract"
                    : "Remaining on contracts"
                }
                value={fmtTons(report.summary.totalRemainingTons)}
                sub="t (cumulative)"
              />
            ) : null}
            <SummaryCard
              label="Accepted pieces"
              value={report.summary.totalAcceptedPieces}
            />
            <SummaryCard
              label="Open / cancelled"
              value={`${report.summary.open} / ${report.summary.cancelled}`}
            />
          </div>

          {(report.filters.supplierName || report.filters.contractNumber) && (
            <p className="text-sm text-muted-foreground">
              {report.filters.supplierName ? (
                <>
                  Supplier:{" "}
                  <span className="font-medium">{report.filters.supplierName}</span>
                </>
              ) : null}
              {report.filters.supplierName && report.filters.contractNumber
                ? " · "
                : null}
              {report.filters.contractNumber ? (
                <>
                  Contract:{" "}
                  <span className="font-medium">{report.filters.contractNumber}</span>
                </>
              ) : null}
            </p>
          )}

          <Card className="shadow-sm">
            <CardContent className="p-4 space-y-3">
              <h2 className="text-base font-semibold">1. By supplier</h2>
              <div className="rounded-lg border overflow-x-auto min-w-0">
                <Table
                  dir="ltr"
                  className={showRemaining ? "min-w-[560px]" : "min-w-[420px]"}
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Loads</TableHead>
                      <TableHead className="text-right">Tons today</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                      {showRemaining ? (
                        <TableHead className="text-right">Remaining (t)</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.bySupplier.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={showRemaining ? 5 : 4}
                          className="text-center py-8 text-muted-foreground"
                        >
                          No completed receipts in this day
                        </TableCell>
                      </TableRow>
                    ) : (
                      report.bySupplier.map((row) => (
                        <TableRow key={row.supplierName}>
                          <TableCell className="font-medium">{row.supplierName}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.loads}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtTons(row.tons)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtPct(row.sharePct)}
                          </TableCell>
                          {showRemaining ? (
                            <TableCell
                              className={`text-right tabular-nums ${
                                row.remainingTons < 0 ? "text-destructive" : ""
                              }`}
                            >
                              {fmtTons(row.remainingTons)}
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  {report.bySupplier.length > 0 ? (
                    <TableFooter>
                      <TableRow>
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {report.summary.includedLoads}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtTons(report.summary.totalNetTons)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">100.0%</TableCell>
                        {showRemaining ? (
                          <TableCell
                            className={`text-right tabular-nums ${
                              report.summary.totalRemainingTons < 0
                                ? "text-destructive"
                                : ""
                            }`}
                          >
                            {fmtTons(report.summary.totalRemainingTons)}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    </TableFooter>
                  ) : null}
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="p-4 space-y-3">
              <h2 className="text-base font-semibold">2. By contract</h2>
              {showRemaining ? (
                <p className="text-xs text-muted-foreground">
                  Remaining is cumulative (contracted − all completed receipts to date),
                  not only today&apos;s loads.
                  {report.filters.contractNumber
                    ? " Filtered to the selected contract."
                    : " Showing all contracts for the selected supplier."}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Select a supplier or contract to see contracted / received / remaining
                  balance.
                </p>
              )}
              <div className="rounded-lg border overflow-x-auto min-w-0">
                <Table
                  dir="ltr"
                  className={showRemaining ? "min-w-[720px]" : "min-w-[480px]"}
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contract</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Loads</TableHead>
                      <TableHead className="text-right">Tons today</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                      {showRemaining ? (
                        <>
                          <TableHead className="text-right">Contracted (t)</TableHead>
                          <TableHead className="text-right">Received (t)</TableHead>
                          <TableHead className="text-right">Remaining (t)</TableHead>
                        </>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byContract.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={showRemaining ? 8 : 5}
                          className="text-center py-8 text-muted-foreground"
                        >
                          No completed receipts in this day
                        </TableCell>
                      </TableRow>
                    ) : (
                      report.byContract.map((row) => (
                        <TableRow key={row.contractNumber}>
                          <TableCell className="font-medium tabular-nums">
                            {row.contractNumber}
                          </TableCell>
                          <TableCell>{row.supplierName}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.loads}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtTons(row.tons)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtPct(row.sharePct)}
                          </TableCell>
                          {showRemaining ? (
                            <>
                              <TableCell className="text-right tabular-nums">
                                {fmtTons(row.contractedTons)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {fmtTons(row.receivedToDateTons)}
                              </TableCell>
                              <TableCell
                                className={`text-right tabular-nums ${
                                  row.remainingTons < 0 ? "text-destructive" : ""
                                }`}
                              >
                                {fmtTons(row.remainingTons)}
                              </TableCell>
                            </>
                          ) : null}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  {report.byContract.length > 0 ? (
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={2}>Total</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {report.summary.includedLoads}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtTons(report.summary.totalNetTons)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">100.0%</TableCell>
                        {showRemaining ? (
                          <>
                            <TableCell className="text-right tabular-nums">
                              {fmtTons(
                                report.byContract.reduce(
                                  (sum, row) => sum + row.contractedTons,
                                  0,
                                ),
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtTons(
                                report.byContract.reduce(
                                  (sum, row) => sum + row.receivedToDateTons,
                                  0,
                                ),
                              )}
                            </TableCell>
                            <TableCell
                              className={`text-right tabular-nums ${
                                report.summary.totalRemainingTons < 0
                                  ? "text-destructive"
                                  : ""
                              }`}
                            >
                              {fmtTons(report.summary.totalRemainingTons)}
                            </TableCell>
                          </>
                        ) : null}
                      </TableRow>
                    </TableFooter>
                  ) : null}
                </Table>
              </div>
            </CardContent>
          </Card>
              </>
            );
          })()}

          <Card className="shadow-sm">
            <CardContent className="p-4 space-y-3">
              <h2 className="text-base font-semibold">3. By length</h2>
              <div className="rounded-lg border overflow-x-auto min-w-0">
                <Table dir="ltr" className="min-w-[420px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Length</TableHead>
                      <TableHead className="text-right">Accepted pcs</TableHead>
                      <TableHead className="text-right">Receipts</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.lengthTotals.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-center py-8 text-muted-foreground"
                        >
                          No completed receipts with piece counts in this day
                        </TableCell>
                      </TableRow>
                    ) : (
                      report.lengthTotals.map((row) => (
                        <TableRow key={row.billetLengthM}>
                          <TableCell className="font-medium">
                            {row.billetLengthM} m
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.acceptedPieces}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.receiptCount}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtPct(row.sharePct)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  {report.lengthTotals.length > 0 ? (
                    <TableFooter>
                      <TableRow>
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {report.summary.totalAcceptedPieces}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {report.summary.includedLoads}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">100.0%</TableCell>
                      </TableRow>
                    </TableFooter>
                  ) : null}
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {report ? <DailyBilletPrintable report={report} /> : null}
    </div>
  );
}

const PRINT_STYLE = `
#daily-billet-print {
  color: #000;
  font-family: Calibri, Arial, sans-serif;
  font-size: 10px;
  line-height: 1.2;
  background: #fff;
  transform-origin: top left;
}
#daily-billet-print .print-title {
  font-size: 13px;
  font-weight: 700;
  margin: 0 0 2px;
}
#daily-billet-print .section-title {
  color: #2b3f55;
  font-size: 12px;
  font-weight: 700;
  margin: 12px 0 7px 6px;
}
#daily-billet-print table {
  border: 1px solid #c7d1df;
  border-collapse: collapse;
  margin-bottom: 11px;
  table-layout: fixed;
}
#daily-billet-print .narrow-table {
  width: 58%;
  margin-left: auto;
  margin-right: auto;
}
#daily-billet-print .wide-table {
  width: 100%;
}
#daily-billet-print th, #daily-billet-print td {
  border: 1px solid #c7d1df;
  padding: 4px 7px;
  text-align: left;
  word-break: break-word;
  overflow-wrap: anywhere;
}
#daily-billet-print th {
  background: #1f3864;
  color: #fff;
  font-weight: 700;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#daily-billet-print tbody tr:nth-child(even):not(.total-row) td {
  background: #f1f4fa;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#daily-billet-print .total-row td {
  background: #dbe5f3;
  font-weight: 700;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#daily-billet-print thead { display: table-header-group; }
#daily-billet-print tr { break-inside: avoid; }
#daily-billet-print .num { text-align: right; font-variant-numeric: tabular-nums; }
#daily-billet-print .headline { font-size: 10px; color: #222; margin: 0 0 4px; }
#daily-billet-print .pagefoot { text-align: center; font-size: 10px; color: #555; margin-top: 14px; }

@media screen {
  #daily-billet-print { display: none; }
  #daily-billet-print.is-measuring {
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
  body > *:not(#daily-billet-print) { display: none !important; }
  #daily-billet-print {
    display: block;
    width: 100%;
  }
}
`;

const MIN_PRINT_FIT_SCALE = 0.6;

function DailyBilletPrintable({ report }: { report: DailyBilletReport }) {
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

  const showRemaining =
    !!report.filters.supplierName || !!report.filters.contractNumber;

  const content = (
    <div id="daily-billet-print" dir="ltr" ref={printRef}>
      <h1 className="print-title">{BRAND.name} — Billet Receiving Summary</h1>
      <p className="headline">{buildHeaderLine(report)}</p>
      {report.filters.supplierName ? (
        <p className="headline">Supplier filter: {report.filters.supplierName}</p>
      ) : null}
      {report.filters.contractNumber ? (
        <p className="headline">Contract filter: {report.filters.contractNumber}</p>
      ) : null}

      <h2 className="section-title">1. By supplier</h2>
      <table className="narrow-table">
        <thead>
          <tr>
            <th>Supplier</th>
            <th className="num">Loads</th>
            <th className="num">Tons today</th>
            <th className="num">Share</th>
            {showRemaining ? <th className="num">Remaining (t)</th> : null}
          </tr>
        </thead>
        <tbody>
          {report.bySupplier.map((row) => (
            <tr key={row.supplierName}>
              <td>{row.supplierName}</td>
              <td className="num">{row.loads}</td>
              <td className="num">{fmtTons(row.tons)}</td>
              <td className="num">{fmtPct(row.sharePct)}</td>
              {showRemaining ? (
                <td className="num">{fmtTons(row.remainingTons)}</td>
              ) : null}
            </tr>
          ))}
          <tr className="total-row">
            <td>Total</td>
            <td className="num">{report.summary.includedLoads}</td>
            <td className="num">{fmtTons(report.summary.totalNetTons)}</td>
            <td className="num">100.0%</td>
            {showRemaining ? (
              <td className="num">{fmtTons(report.summary.totalRemainingTons)}</td>
            ) : null}
          </tr>
        </tbody>
      </table>

      <h2 className="section-title">2. By contract</h2>
      {showRemaining ? (
        <p className="headline">
          Remaining is cumulative (contracted − all completed receipts to date).
        </p>
      ) : null}
      <table className="wide-table">
        <thead>
          <tr>
            <th>Contract</th>
            <th>Supplier</th>
            <th className="num">Loads</th>
            <th className="num">Tons today</th>
            <th className="num">Share</th>
            {showRemaining ? (
              <>
                <th className="num">Contracted (t)</th>
                <th className="num">Received (t)</th>
                <th className="num">Remaining (t)</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {report.byContract.map((row) => (
            <tr key={row.contractNumber}>
              <td>{row.contractNumber}</td>
              <td>{row.supplierName}</td>
              <td className="num">{row.loads}</td>
              <td className="num">{fmtTons(row.tons)}</td>
              <td className="num">{fmtPct(row.sharePct)}</td>
              {showRemaining ? (
                <>
                  <td className="num">{fmtTons(row.contractedTons)}</td>
                  <td className="num">{fmtTons(row.receivedToDateTons)}</td>
                  <td className="num">{fmtTons(row.remainingTons)}</td>
                </>
              ) : null}
            </tr>
          ))}
          <tr className="total-row">
            <td colSpan={2}>Total</td>
            <td className="num">{report.summary.includedLoads}</td>
            <td className="num">{fmtTons(report.summary.totalNetTons)}</td>
            <td className="num">100.0%</td>
            {showRemaining ? (
              <>
                <td className="num">
                  {fmtTons(
                    report.byContract.reduce(
                      (sum, row) => sum + row.contractedTons,
                      0,
                    ),
                  )}
                </td>
                <td className="num">
                  {fmtTons(
                    report.byContract.reduce(
                      (sum, row) => sum + row.receivedToDateTons,
                      0,
                    ),
                  )}
                </td>
                <td className="num">{fmtTons(report.summary.totalRemainingTons)}</td>
              </>
            ) : null}
          </tr>
        </tbody>
      </table>

      <h2 className="section-title">3. By length</h2>
      <table className="narrow-table">
        <thead>
          <tr>
            <th>Length</th>
            <th className="num">Accepted pcs</th>
            <th className="num">Receipts</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {report.lengthTotals.map((row) => (
            <tr key={row.billetLengthM}>
              <td>{row.billetLengthM} m</td>
              <td className="num">{row.acceptedPieces}</td>
              <td className="num">{row.receiptCount}</td>
              <td className="num">{fmtPct(row.sharePct)}</td>
            </tr>
          ))}
          <tr className="total-row">
            <td>Total</td>
            <td className="num">{report.summary.totalAcceptedPieces}</td>
            <td className="num">{report.summary.includedLoads}</td>
            <td className="num">100.0%</td>
          </tr>
        </tbody>
      </table>

      <h2 className="section-title">4. Net weighbridge total</h2>
      <p className="headline">
        Net is the external weighbridge (قبان) weight: loaded − empty, for receipts
        completed within the operational day.
        {showRemaining
          ? " Remaining is cumulative contract balance."
          : ""}
      </p>
      <table className="narrow-table">
        <tbody>
          <tr>
            <th>Total net today (قبان)</th>
            <td className="num">{fmtTons(report.summary.totalNetTons)} t</td>
          </tr>
          <tr>
            <th>Included receipts</th>
            <td className="num">{report.summary.includedLoads}</td>
          </tr>
          <tr className={showRemaining ? undefined : "total-row"}>
            <th>Accepted pieces</th>
            <td className="num">{report.summary.totalAcceptedPieces}</td>
          </tr>
          {showRemaining ? (
            <tr className="total-row">
              <th>
                {report.filters.contractNumber
                  ? "Remaining on contract"
                  : "Remaining on contracts"}
              </th>
              <td className="num">{fmtTons(report.summary.totalRemainingTons)} t</td>
            </tr>
          ) : null}
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
