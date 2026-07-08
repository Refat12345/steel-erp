// SECURITY NOTE: xlsx@0.18.5 has known CVEs (prototype pollution, ReDoS) in its *read/parse* path only.
// We use it strictly for export (write). Do NOT add XLSX.read() of external files anywhere before replacing this library.
import * as XLSX from "xlsx";
import { formatDateTime } from "@/lib/date-format";
import { BRAND } from "@/lib/brand";
import type { BilletBalanceReport } from "@/lib/services/billet-contract.service";

function kg(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildSummarySheet(report: BilletBalanceReport): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    [`${BRAND.name} — Billet Receiving Balance`],
    ["Supplier", report.filters.supplierName],
    ["Contract filter", report.filters.contractNumber ?? "All contracts"],
    ["Generated", formatDateTime(report.generatedAt)],
    [],
    ["Contracted weight (kg)", kg(report.totals.contractedWeightKg)],
    ["Received weight (kg)", kg(report.totals.receivedWeightKg)],
    ["Remaining weight (kg)", kg(report.totals.remainingWeightKg)],
    ["Completed receipts", report.totals.completedReceiptCount],
    [],
    ["Length (m)", "Contracted pcs", "Received pcs", "Remaining pcs"],
    ...report.pieceTotals.map((row) => [
      row.billetLengthM,
      row.contractedPieces,
      row.acceptedPieces,
      row.remainingPieces,
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 28 }, { wch: 24 }, { wch: 16 }, { wch: 16 }];
  return sheet;
}

function buildContractsSheet(report: BilletBalanceReport): XLSX.WorkSheet {
  const lengthCols = report.lengthColumns;
  const header = [
    "Contract",
    "Status",
    "Contracted (kg)",
    "Received (kg)",
    "Remaining (kg)",
    "Completed receipts",
    ...lengthCols.flatMap((len) => [`${len}m received`, `${len}m remaining`]),
  ];

  const body = report.contracts.map((row) => [
    row.contractNumber,
    row.status,
    kg(row.contractedWeightKg),
    kg(row.receivedWeightKg),
    kg(row.remainingWeightKg),
    row.completedReceiptCount,
    ...lengthCols.flatMap((len) => {
      const piece = row.pieceBalances.find((p) => p.billetLengthM === len);
      return [piece?.acceptedPieces ?? 0, piece?.remainingPieces ?? 0];
    }),
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  return sheet;
}

function buildReceiptsSheet(report: BilletBalanceReport): XLSX.WorkSheet {
  const lengthCols = report.lengthColumns;
  const header = [
    "Receipt",
    "Type",
    "Contract",
    "Completed at",
    "Plate",
    "Driver",
    "Net (kg)",
    ...lengthCols.map((len) => `${len}m accepted`),
  ];

  const body = report.receipts.map((row) => [
    row.receiptNumber,
    row.isPriorWithdrawal ? "Prior withdrawal" : "Receipt",
    row.contractNumber,
    row.priorWithdrawalDate
      ? formatDateTime(row.priorWithdrawalDate)
      : row.completedAt
        ? formatDateTime(row.completedAt)
        : "-",
    row.plateNumber,
    row.driverName,
    row.netWeightKg != null ? kg(row.netWeightKg) : "-",
    ...lengthCols.map((len) => row.acceptedByLength[String(len)] ?? "-"),
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  return sheet;
}

export function exportBilletBalanceExcel(report: BilletBalanceReport): void {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildSummarySheet(report), "Summary");
  if (report.contracts.length > 1 && !report.filters.contractNumber) {
    XLSX.utils.book_append_sheet(workbook, buildContractsSheet(report), "Contracts");
  }
  XLSX.utils.book_append_sheet(workbook, buildReceiptsSheet(report), "Receipts");

  const slug = report.filters.supplierName.replace(/\s+/g, "-").slice(0, 24);
  XLSX.writeFile(workbook, `billet-balance-${slug}.xlsx`);
}
