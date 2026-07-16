// SECURITY NOTE: xlsx@0.18.5 has known CVEs (prototype pollution, ReDoS) in its *read/parse* path only.
// We use it strictly for export (write). Do NOT add XLSX.read() of external files anywhere before replacing this library.
import * as XLSX from "xlsx";
import { formatDateTime } from "@/lib/date-format";
import { BRAND } from "@/lib/brand";
import type { DailyBilletReport } from "@/lib/services/report.service";

function tons(value: number | null | undefined): number | string {
  if (value == null) return "-";
  return Math.round(value * 1000) / 1000;
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function receivingDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
}

function showRemainingBalance(report: DailyBilletReport): boolean {
  return !!report.filters.supplierName || !!report.filters.contractNumber;
}

function buildSummarySheet(report: DailyBilletReport): XLSX.WorkSheet {
  const showRemaining = showRemainingBalance(report);
  const rows: (string | number)[][] = [
    [`${BRAND.name} — Billet Receiving Summary`],
    ["Receiving date", receivingDate(report.operationalDate)],
    ["Generated", formatDateTime(report.generatedAt)],
    ["Window", report.windowLabel],
  ];
  if (report.filters.supplierName) {
    rows.push(["Supplier filter", report.filters.supplierName]);
  }
  if (report.filters.contractNumber) {
    rows.push(["Contract filter", report.filters.contractNumber]);
  }
  rows.push([]);
  rows.push(["Included receipts", report.summary.includedLoads]);
  rows.push(["Total net today (bridge, t)", tons(report.summary.totalNetTons)]);
  if (showRemaining) {
    rows.push([
      "Remaining on contract(s) (t)",
      tons(report.summary.totalRemainingTons),
    ]);
  }
  rows.push(["Accepted pieces", report.summary.totalAcceptedPieces]);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 32 }, { wch: 32 }];
  return sheet;
}

function buildBySupplierSheet(report: DailyBilletReport): XLSX.WorkSheet {
  const showRemaining = showRemainingBalance(report);
  const header = showRemaining
    ? ["Supplier", "Loads", "Tons today", "Share", "Remaining (t)"]
    : ["Supplier", "Loads", "Tons today", "Share"];
  const body = report.bySupplier.map((row) =>
    showRemaining
      ? [
          row.supplierName,
          row.loads,
          tons(row.tons),
          pct(row.sharePct),
          tons(row.remainingTons),
        ]
      : [row.supplierName, row.loads, tons(row.tons), pct(row.sharePct)],
  );
  body.push(
    showRemaining
      ? [
          "Total",
          report.summary.includedLoads,
          tons(report.summary.totalNetTons),
          "100.0%",
          tons(report.summary.totalRemainingTons),
        ]
      : [
          "Total",
          report.summary.includedLoads,
          tons(report.summary.totalNetTons),
          "100.0%",
        ],
  );
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = showRemaining
    ? [{ wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 14 }]
    : [{ wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];
  return sheet;
}

function buildByContractSheet(report: DailyBilletReport): XLSX.WorkSheet {
  const showRemaining = showRemainingBalance(report);
  const header = showRemaining
    ? [
        "Contract",
        "Supplier",
        "Loads",
        "Tons today",
        "Share",
        "Contracted (t)",
        "Received to date (t)",
        "Remaining (t)",
      ]
    : ["Contract", "Supplier", "Loads", "Tons today", "Share"];
  const body = report.byContract.map((row) =>
    showRemaining
      ? [
          row.contractNumber,
          row.supplierName,
          row.loads,
          tons(row.tons),
          pct(row.sharePct),
          tons(row.contractedTons),
          tons(row.receivedToDateTons),
          tons(row.remainingTons),
        ]
      : [
          row.contractNumber,
          row.supplierName,
          row.loads,
          tons(row.tons),
          pct(row.sharePct),
        ],
  );
  body.push(
    showRemaining
      ? [
          "Total",
          "",
          report.summary.includedLoads,
          tons(report.summary.totalNetTons),
          "100.0%",
          tons(report.byContract.reduce((sum, row) => sum + row.contractedTons, 0)),
          tons(
            report.byContract.reduce(
              (sum, row) => sum + row.receivedToDateTons,
              0,
            ),
          ),
          tons(report.summary.totalRemainingTons),
        ]
      : [
          "Total",
          "",
          report.summary.includedLoads,
          tons(report.summary.totalNetTons),
          "100.0%",
        ],
  );
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = showRemaining
    ? [
        { wch: 14 },
        { wch: 26 },
        { wch: 10 },
        { wch: 12 },
        { wch: 10 },
        { wch: 14 },
        { wch: 18 },
        { wch: 14 },
      ]
    : [{ wch: 14 }, { wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];
  return sheet;
}

function buildByLengthSheet(report: DailyBilletReport): XLSX.WorkSheet {
  const header = ["Length (m)", "Accepted pcs", "Receipts", "Share"];
  const body = report.lengthTotals.map((row) => [
    row.billetLengthM,
    row.acceptedPieces,
    row.receiptCount,
    pct(row.sharePct),
  ]);
  body.push([
    "Total",
    report.summary.totalAcceptedPieces,
    report.summary.includedLoads,
    "100.0%",
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 10 }];
  return sheet;
}

export function exportDailyBilletExcel(report: DailyBilletReport): void {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildSummarySheet(report), "Summary");
  XLSX.utils.book_append_sheet(workbook, buildBySupplierSheet(report), "By supplier");
  XLSX.utils.book_append_sheet(workbook, buildByContractSheet(report), "By contract");
  XLSX.utils.book_append_sheet(workbook, buildByLengthSheet(report), "By length");
  XLSX.writeFile(workbook, `billet-receiving-${report.operationalDate}.xlsx`);
}
