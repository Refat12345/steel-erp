import * as XLSX from "xlsx";
import { formatDateTime } from "@/lib/date-format";
import { toEnglishCity, toEnglishSize } from "@/lib/en-labels";
import { BRAND } from "@/lib/brand";
import type { DailyLoadingSummary } from "@/lib/services/report.service";

function tons(value: number | null | undefined): number | string {
  if (value == null) return "-";
  return Math.round(value * 1000) / 1000;
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function loadingDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
}

function periodRow(report: DailyLoadingSummary): [string, string] {
  if (report.period === "weekly") {
    return [
      "Week",
      `${loadingDate(report.periodStartDate)} → ${loadingDate(report.periodEndDate)}`,
    ];
  }
  if (report.period === "monthly") {
    const [y, m] = report.periodStartDate.split("-").map(Number);
    const monthName = new Date(y, m - 1, 1).toLocaleString("en-US", {
      month: "long",
    });
    return ["Month", `${monthName} ${y}`];
  }
  return ["Loading date", loadingDate(report.periodStartDate)];
}

function buildSummarySheet(report: DailyLoadingSummary): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    [`${BRAND.name} — Loading Summary`],
    periodRow(report),
    ["Generated", formatDateTime(report.generatedAt)],
    ["Window", report.windowLabelAr],
  ];
  if (report.filters.customerName) {
    rows.push(["Customer filter", report.filters.customerName]);
  }
  if (report.filters.grade) {
    rows.push([
      "Grade filter",
      report.filters.grade === "FIRST" ? "First grade" : "Second grade",
    ]);
  }
  rows.push([]);
  rows.push(["Trucks", report.totals.truckCount]);
  rows.push(["Total dispatched (bridge, t)", tons(report.totals.totalBridgeTons)]);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 28 }, { wch: 32 }];
  return sheet;
}

function buildByCustomerSheet(report: DailyLoadingSummary): XLSX.WorkSheet {
  const header = ["Customer", "Loads", "Tons", "Share"];
  const body = report.byCustomer.map((row) => [
    row.customerName,
    row.loads,
    tons(row.tons),
    pct(row.sharePct),
  ]);
  body.push([
    "Total",
    report.totals.truckCount,
    tons(report.totals.totalBridgeTons),
    "100.0%",
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = [{ wch: 26 }, { wch: 10 }, { wch: 14 }, { wch: 10 }];
  return sheet;
}

function buildByCitySheet(report: DailyLoadingSummary): XLSX.WorkSheet {
  const header = ["City", "Loads", "Tons", "Share"];
  const body = report.byCity.map((row) => [
    toEnglishCity(row.cityName),
    row.loads,
    tons(row.tons),
    pct(row.sharePct),
  ]);
  body.push([
    "Total",
    report.totals.truckCount,
    tons(report.totals.totalBridgeTons),
    "100.0%",
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 10 }];
  return sheet;
}

function buildCitySizeSheet(report: DailyLoadingSummary): XLSX.WorkSheet {
  const header = [
    "City",
    ...report.sizeColumns.map((col) => toEnglishSize(col.displayName, col.code)),
    "Total",
  ];
  const body = report.byCitySize.map((row) => [
    toEnglishCity(row.cityName),
    ...report.sizeColumns.map((col) => tons(row.sizeTons[col.key])),
    tons(row.totalTons),
  ]);
  body.push([
    "Total",
    ...report.sizeColumns.map((col) => tons(report.citySizeColumnTotals[col.key])),
    tons(report.totals.totalInternalTons),
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = [
    { wch: 22 },
    ...report.sizeColumns.map(() => ({ wch: 10 })),
    { wch: 12 },
  ];
  return sheet;
}

export function exportDailyLoadingSummaryExcel(report: DailyLoadingSummary): void {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, buildSummarySheet(report), "Summary");
  XLSX.utils.book_append_sheet(workbook, buildByCustomerSheet(report), "By customer");
  XLSX.utils.book_append_sheet(workbook, buildByCitySheet(report), "By city");
  XLSX.utils.book_append_sheet(
    workbook,
    buildCitySizeSheet(report),
    "By size & city",
  );

  XLSX.writeFile(
    workbook,
    `loading-summary-${report.period}-${report.periodStartDate}.xlsx`,
  );
}
