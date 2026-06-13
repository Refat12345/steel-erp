import * as XLSX from "xlsx";
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
import type {
  DailyTrucksReport,
  DailyTruckRow,
} from "@/lib/services/report.service";

function tons(value: number | null): number | string {
  if (value == null) return "—";
  return Math.round(value * 1000) / 1000;
}

function bundles(value: number | null): number | string {
  return value == null ? "—" : value;
}

function dateTimeOrDash(iso: string | null): string {
  return iso ? formatDateTime(iso) : "—";
}

function buildSummarySheet(report: DailyTrucksReport): XLSX.WorkSheet {
  const canSensitive = report.permissions.canViewSensitiveTonnage;
  const rows: (string | number)[][] = [
    ["Daily Trucks Report"],
    ["Operational day", report.operationalDate],
    ["Window", report.windowLabelAr],
  ];
  if (report.filters.customerName) {
    rows.push(["Customer filter", report.filters.customerName]);
  }
  if (report.filters.productFilter) {
    rows.push([
      "Product filter",
      productFilterLabelEn(report.filters.productFilter),
    ]);
  }
  rows.push([]);
  rows.push(["Registered", report.summary.registered]);
  rows.push(["Completed", report.summary.completed]);
  rows.push(["Cancelled", report.summary.cancelled]);
  rows.push(["Open", report.summary.open]);
  rows.push(["Bridge total (t)", tons(report.summary.totalBridgeTons)]);
  if (canSensitive) {
    rows.push(["Internal total (t)", tons(report.summary.totalInternalTons)]);
    rows.push(["Discrepancy total (t)", tons(report.summary.totalDiscrepancyTons)]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 22 }, { wch: 32 }];
  return sheet;
}

function buildTrucksSheet(report: DailyTrucksReport): XLSX.WorkSheet {
  const canSensitive = report.permissions.canViewSensitiveTonnage;
  const header = [
    "#",
    "Plate",
    "Driver",
    "Customer",
    "Destination",
    "Sales order",
    "Grade",
    "Registered",
    "Internal loading time",
    "Status",
    "Bridge (t)",
    ...(canSensitive ? ["Internal (t)", "Discrepancy (t)"] : []),
    "Note",
  ];

  const body = report.rows.map((row: DailyTruckRow, index: number) => [
    index + 1,
    row.plateNumber,
    row.driverName,
    row.customer?.fullName ?? "—",
    toEnglishCity(row.destination?.name),
    row.salesOrderNumber ?? "—",
    gradeLabelEn(row.grade),
    dateTimeOrDash(row.createdAt),
    formatDurationCompactEn(row.internalLoadingMs),
    TRUCK_STATUS_EN[row.status],
    tons(row.bridgeTons),
    ...(canSensitive ? [tons(row.internalTons), tons(row.discrepancyTons)] : []),
    tonnageNoteEn(row.tonnageStatus, row.cancelReason, row.isPartialVisit) ?? "—",
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = [
    { wch: 5 },
    { wch: 12 },
    { wch: 16 },
    { wch: 22 },
    { wch: 16 },
    { wch: 14 },
    { wch: 10 },
    { wch: 18 },
    { wch: 18 },
    { wch: 12 },
    { wch: 11 },
    ...(canSensitive ? [{ wch: 11 }, { wch: 11 }] : []),
    { wch: 28 },
  ];
  return sheet;
}

function buildSizeTotalsSheet(report: DailyTrucksReport): XLSX.WorkSheet {
  const header = ["Size", "Internal total (t)", "Bundles", "Trucks"];
  const body = report.sizeTotals.map((sizeTotal) => [
    toEnglishSize(sizeTotal.displayName),
    tons(sizeTotal.totalTons),
    bundles(sizeTotal.totalBundles),
    sizeTotal.truckCount,
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = [{ wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 12 }];
  return sheet;
}

function buildDetailsSheet(report: DailyTrucksReport): XLSX.WorkSheet {
  const header = ["#", "Plate", "Customer", "Size", "Weight (t)", "Bundles"];
  const body: (string | number)[][] = [];
  report.rows.forEach((row, index) => {
    if (row.sizeBreakdown.length === 0) {
      body.push([
        index + 1,
        row.plateNumber,
        row.customer?.fullName ?? "—",
        "—",
        "—",
        "—",
      ]);
      return;
    }
    for (const item of row.sizeBreakdown) {
      body.push([
        index + 1,
        row.plateNumber,
        row.customer?.fullName ?? "—",
        toEnglishSize(item.displayName),
        tons(item.weightTons),
        bundles(item.bundleCount),
      ]);
    }
  });
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = [
    { wch: 5 },
    { wch: 12 },
    { wch: 22 },
    { wch: 20 },
    { wch: 12 },
    { wch: 12 },
  ];
  return sheet;
}

export function exportDailyTrucksExcel(
  report: DailyTrucksReport,
  options: { includeDetails: boolean },
): void {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, buildSummarySheet(report), "Summary");
  XLSX.utils.book_append_sheet(workbook, buildTrucksSheet(report), "Trucks");
  XLSX.utils.book_append_sheet(
    workbook,
    buildSizeTotalsSheet(report),
    "Totals by size",
  );
  if (options.includeDetails) {
    XLSX.utils.book_append_sheet(
      workbook,
      buildDetailsSheet(report),
      "Size details",
    );
  }

  XLSX.writeFile(workbook, `daily-trucks-${report.operationalDate}.xlsx`);
}
