"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Boxes,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Loader2,
  Printer,
  RefreshCw,
} from "lucide-react";
import { sessionHasPermission } from "@/lib/client-permissions";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { exportBilletBalanceExcel } from "@/lib/export/billet-balance-excel";
import { BRAND } from "@/lib/brand";
import { REPORTS_PERMISSION } from "@/lib/rbac-policy";
import type {
  BilletBalanceReport,
  BilletSupplierOption,
} from "@/lib/services/billet-contract.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const CONTRACT_STATUS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  Active: { label: "Active", variant: "default" },
  Completed: { label: "Completed", variant: "secondary" },
  Cancelled: { label: "Cancelled", variant: "destructive" },
};

function formatKg(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function formatTonsFromKg(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return (value / 1000).toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function acceptedForLength(
  row: { acceptedByLength: Record<string, number> },
  lengthM: number,
): string {
  return row.acceptedByLength[String(lengthM)] == null
    ? "-"
    : String(row.acceptedByLength[String(lengthM)]);
}

function pieceForLength(
  row: BilletBalanceReport["contracts"][number],
  lengthM: number,
) {
  return row.pieceBalances.find((piece) => piece.billetLengthM === lengthM);
}

function statusBadge(status: string) {
  return CONTRACT_STATUS[status] ?? { label: status, variant: "secondary" as const };
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
    <Card className="overflow-hidden border shadow-sm">
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
          {value}
        </p>
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

const PRINT_STYLE = `
#billet-balance-print {
  color: #000;
  font-family: Calibri, Arial, sans-serif;
  font-size: 10px;
  line-height: 1.2;
  background: #fff;
}
#billet-balance-print .print-title {
  font-size: 13px;
  font-weight: 700;
  margin: 0 0 3px;
}
#billet-balance-print .headline {
  font-size: 10px;
  color: #222;
  margin: 0 0 4px;
}
#billet-balance-print .section-title {
  color: #2b3f55;
  font-size: 12px;
  font-weight: 700;
  margin: 12px 0 7px;
}
#billet-balance-print table {
  width: 100%;
  border: 1px solid #c7d1df;
  border-collapse: collapse;
  margin-bottom: 11px;
  table-layout: fixed;
}
#billet-balance-print th,
#billet-balance-print td {
  border: 1px solid #c7d1df;
  padding: 4px 7px;
  text-align: left;
  word-break: break-word;
}
#billet-balance-print th {
  background: #1f3864;
  color: #fff;
  font-weight: 700;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#billet-balance-print tbody tr:nth-child(even):not(.total-row) td {
  background: #f1f4fa;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#billet-balance-print .total-row td {
  background: #dbe5f3;
  font-weight: 700;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#billet-balance-print thead { display: table-header-group; }
#billet-balance-print tr { break-inside: avoid; }
#billet-balance-print .num { font-variant-numeric: tabular-nums; }

@media screen {
  #billet-balance-print { display: none; }
}
@media print {
  @page { size: portrait; margin: 10mm; }
  html, body { background: #fff !important; }
  body > *:not(#billet-balance-print) { display: none !important; }
  #billet-balance-print { display: block; width: 100%; }
}
`;

function BilletBalancePrintable({ report }: { report: BilletBalanceReport }) {
  const showContracts = !report.filters.contractNumber && report.contracts.length > 1;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const content = (
    <div id="billet-balance-print" dir="ltr">
      <style>{PRINT_STYLE}</style>
      <h1 className="print-title">{BRAND.name} - Billet Receiving Balance</h1>
      <p className="headline">Supplier: {report.filters.supplierName}</p>
      <p className="headline">
        Contract: {report.filters.contractNumber ?? "All contracts"} | Generated:{" "}
        {formatDateTime(report.generatedAt)}
      </p>

      <h2 className="section-title">1. Weight Summary</h2>
      <table>
        <tbody>
          <tr>
            <th>Contracted (t)</th>
            <td className="num">{formatTonsFromKg(report.totals.contractedWeightKg)}</td>
            <th>Received (t)</th>
            <td className="num">{formatTonsFromKg(report.totals.receivedWeightKg)}</td>
            <th>Remaining (t)</th>
            <td className="num">{formatTonsFromKg(report.totals.remainingWeightKg)}</td>
            <th>Completed receipts</th>
            <td className="num">{report.totals.completedReceiptCount}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="section-title">2. Pieces by Length</h2>
      <table>
        <thead>
          <tr>
            <th>Length</th>
            <th className="num">Contracted</th>
            <th className="num">Received</th>
            <th className="num">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {report.pieceTotals.map((row) => (
            <tr key={row.billetLengthM}>
              <td>{row.billetLengthM}m</td>
              <td className="num">{row.contractedPieces}</td>
              <td className="num">{row.acceptedPieces}</td>
              <td className="num">{row.remainingPieces}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {showContracts ? (
        <>
          <h2 className="section-title">3. Contract Details</h2>
          <table>
            <thead>
              <tr>
                <th>Contract</th>
                <th className="num">Contracted (kg)</th>
                <th className="num">Received (kg)</th>
                <th className="num">Remaining (kg)</th>
                <th className="num">Receipts</th>
              </tr>
            </thead>
            <tbody>
              {report.contracts.map((row) => (
                <tr key={row.contractNumber}>
                  <td>{row.contractNumber}</td>
                  <td className="num">{formatKg(row.contractedWeightKg)}</td>
                  <td className="num">{formatKg(row.receivedWeightKg)}</td>
                  <td className="num">{formatKg(row.remainingWeightKg)}</td>
                  <td className="num">{row.completedReceiptCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );

  if (!mounted) return null;
  return createPortal(content, document.body);
}

export function BilletBalanceReportView() {
  const { data: session, status } = useSession();
  const canView = sessionHasPermission(session, REPORTS_PERMISSION);

  const [suppliers, setSuppliers] = useState<BilletSupplierOption[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [supplierName, setSupplierName] = useState("");
  const [contractNumber, setContractNumber] = useState("all");
  const [loadingReport, setLoadingReport] = useState(false);
  const [report, setReport] = useState<BilletBalanceReport | null>(null);
  const [showReceipts, setShowReceipts] = useState(false);

  const selectedSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.supplierName === supplierName),
    [supplierName, suppliers],
  );

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
    if (!supplierName) {
      toast.error("Select a supplier");
      return;
    }

    setLoadingReport(true);
    try {
      const params = new URLSearchParams({ supplierName });
      if (contractNumber !== "all") {
        params.set("contractNumber", contractNumber);
      }

      const res = await fetch(`/api/reports/billet-balance?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json.error ?? "Failed to load the report");
        setReport(null);
        return;
      }

      setReport(json.data as BilletBalanceReport);
      setShowReceipts(false);
    } catch {
      toast.error("Failed to load the report");
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, [contractNumber, supplierName]);

  useEffect(() => {
    if (status === "authenticated" && canView && supplierName) {
      void fetchReport();
    }
  }, [canView, fetchReport, status, supplierName]);

  function handleSupplierChange(value: string | null) {
    setSupplierName(value ?? "");
    setContractNumber("all");
    setReport(null);
    setShowReceipts(false);
  }

  function handlePrint() {
    if (report) window.print();
  }

  function handleExportExcel() {
    if (!report) return;
    try {
      exportBilletBalanceExcel(report);
    } catch {
      toast.error("Failed to export the Excel file");
    }
  }

  const showContractsTable =
    report != null && !report.filters.contractNumber && report.contracts.length > 1;

  if (status === "loading") {
    return (
      <div className="flex-1 p-4 sm:p-6 space-y-6 min-w-0 max-w-full">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-28 w-full" />
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
    <div className="flex-1 p-4 sm:p-6 space-y-6 min-w-0 max-w-full text-left" dir="ltr">
      <Link
        href="/reports"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Reports
      </Link>

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
          <h1 className="text-xl font-bold truncate">Billet Receiving Balance</h1>
          <p className="text-sm text-muted-foreground">
            Cumulative balance by supplier and contract - completed receipts only
          </p>
        </div>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5 min-w-[13rem] flex-1 sm:max-w-xs">
              <label className="text-xs font-medium text-muted-foreground">Supplier</label>
              <Select
                value={supplierName}
                onValueChange={handleSupplierChange}
                disabled={loadingSuppliers}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.supplierName} value={supplier.supplierName}>
                      {supplier.supplierName}
                      {supplier.contractCount > 1
                        ? ` - ${supplier.contractCount} contracts`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 min-w-[11rem] flex-1 sm:max-w-xs">
              <label className="text-xs font-medium text-muted-foreground">Contract</label>
              <Select
                value={contractNumber}
                onValueChange={(value) => setContractNumber(value ?? "all")}
                disabled={!selectedSupplier}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All contracts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All contracts</SelectItem>
                  {selectedSupplier?.contracts.map((contract) => (
                    <SelectItem
                      key={contract.contractNumber}
                      value={contract.contractNumber}
                    >
                      {contract.contractNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={() => void fetchReport()} disabled={loadingReport || !supplierName}>
              {loadingReport ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ms-2">Refresh</span>
            </Button>

            {report ? (
              <>
                <Button variant="outline" onClick={handlePrint}>
                  <Printer className="h-4 w-4" />
                  <span className="ms-2">Print</span>
                </Button>
                <Button variant="outline" onClick={handleExportExcel}>
                  <FileSpreadsheet className="h-4 w-4" />
                  <span className="ms-2">Excel</span>
                </Button>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {!supplierName ? (
        <Card className="shadow-sm">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Select a supplier to view received and remaining weight and pieces.
          </CardContent>
        </Card>
      ) : loadingReport && !report ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <Skeleton key={item} className="h-24 w-full" />
            ))}
          </div>
          <Skeleton className="h-52 w-full" />
        </div>
      ) : report ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 min-w-0">
            <SummaryCard
              label="Contracted weight"
              value={`${formatTonsFromKg(report.totals.contractedWeightKg)} t`}
              sub={`${formatKg(report.totals.contractedWeightKg)} kg`}
            />
            <SummaryCard
              label="Received weight"
              value={`${formatTonsFromKg(report.totals.receivedWeightKg)} t`}
              sub={`${formatKg(report.totals.receivedWeightKg)} kg`}
            />
            <SummaryCard
              label="Remaining weight"
              value={`${formatTonsFromKg(report.totals.remainingWeightKg)} t`}
              sub={`${formatKg(report.totals.remainingWeightKg)} kg`}
            />
            <SummaryCard label="Completed receipts" value={report.totals.completedReceiptCount} />
          </div>

          <Card className="shadow-sm min-w-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Pieces by Length</CardTitle>
            </CardHeader>
            <CardContent className="p-0 sm:p-0">
              <div className="overflow-x-auto">
                <Table dir="ltr" className="min-w-[420px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Length</TableHead>
                      <TableHead className="text-right">Contracted</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.pieceTotals.map((row) => (
                      <TableRow key={row.billetLengthM}>
                        <TableCell className="font-medium">{row.billetLengthM}m</TableCell>
                        <TableCell className="font-mono tabular-nums text-right">
                          {row.contractedPieces}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums text-right">
                          {row.acceptedPieces}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums text-right">
                          {row.remainingPieces}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {showContractsTable ? (
            <Card className="shadow-sm min-w-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Contract Details</CardTitle>
              </CardHeader>
              <CardContent className="p-0 sm:p-0">
                <div className="overflow-x-auto">
                  <Table dir="ltr" className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Contract</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Contracted (kg)</TableHead>
                        <TableHead className="text-right">Received (kg)</TableHead>
                        <TableHead className="text-right">Remaining (kg)</TableHead>
                        <TableHead className="text-right">Receipts</TableHead>
                        {report.lengthColumns.map((lengthM) => (
                          <TableHead key={lengthM} className="text-right">
                            {lengthM}m remaining
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.contracts.map((row) => {
                        const info = statusBadge(row.status);
                        return (
                          <TableRow key={row.contractNumber}>
                            <TableCell>
                              <Link
                                href={`/billet-contracts/${row.contractNumber}`}
                                className="font-medium text-primary hover:underline"
                              >
                                {row.contractNumber}
                              </Link>
                            </TableCell>
                            <TableCell>
                              <Badge variant={info.variant}>{info.label}</Badge>
                            </TableCell>
                            <TableCell className="font-mono tabular-nums text-right">
                              {formatKg(row.contractedWeightKg)}
                            </TableCell>
                            <TableCell className="font-mono tabular-nums text-right">
                              {formatKg(row.receivedWeightKg)}
                            </TableCell>
                            <TableCell className="font-mono tabular-nums text-right">
                              {formatKg(row.remainingWeightKg)}
                            </TableCell>
                            <TableCell className="font-mono tabular-nums text-right">
                              {row.completedReceiptCount}
                            </TableCell>
                            {report.lengthColumns.map((lengthM) => {
                              const piece = pieceForLength(row, lengthM);
                              return (
                                <TableCell
                                  key={lengthM}
                                  className="font-mono tabular-nums text-right"
                                >
                                  {piece?.remainingPieces ?? "-"}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className="shadow-sm min-w-0">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  Completed Receipts ({report.receipts.length})
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowReceipts((current) => !current)}
                >
                  {showReceipts ? (
                    <>
                      <ChevronUp className="h-4 w-4" />
                      <span className="ms-1">Hide</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4" />
                      <span className="ms-1">Show</span>
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            {showReceipts ? (
              <CardContent className="p-0 sm:p-0">
                {report.receipts.length === 0 ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">
                    No completed receipts for this selection.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table dir="ltr" className="min-w-[900px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10 text-center">#</TableHead>
                          <TableHead>Receipt</TableHead>
                          <TableHead>Contract</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Plate</TableHead>
                          <TableHead>Driver</TableHead>
                          <TableHead className="text-right">Net (kg)</TableHead>
                          {report.lengthColumns.map((lengthM) => (
                            <TableHead key={lengthM} className="text-right">
                              {lengthM}m
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.receipts.map((row, index) => (
                          <TableRow key={row.id}>
                            <TableCell className="text-center tabular-nums">
                              {index + 1}
                            </TableCell>
                            <TableCell>
                              <Link
                                href={`/billet-receipts/${row.id}`}
                                className="font-medium text-primary hover:underline"
                              >
                                {row.receiptNumber}
                              </Link>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {row.contractNumber}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {row.completedAt ? formatDate(row.completedAt) : "-"}
                            </TableCell>
                            <TableCell className="font-mono font-medium">
                              {row.plateNumber}
                            </TableCell>
                            <TableCell className="max-w-[10rem] truncate">
                              {row.driverName}
                            </TableCell>
                            <TableCell className="font-mono tabular-nums text-right">
                              {formatKg(row.netWeightKg)}
                            </TableCell>
                            {report.lengthColumns.map((lengthM) => (
                              <TableCell
                                key={lengthM}
                                className="font-mono tabular-nums text-right"
                              >
                                {acceptedForLength(row, lengthM)}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            ) : null}
          </Card>

          <BilletBalancePrintable report={report} />
        </>
      ) : null}
    </div>
  );
}

export function BilletBalanceReportIndexCard() {
  const { data: session } = useSession();
  const canView = sessionHasPermission(session, REPORTS_PERMISSION);

  if (!canView) return null;

  return (
    <Link href="/reports/billet-balance" className="block min-w-0">
      <Card className="h-full shadow-sm transition-colors hover:bg-muted/40">
        <CardContent className="flex items-start gap-4 p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Boxes className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold">Billet Receiving Balance</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Cumulative supplier balance for received and remaining billet
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
