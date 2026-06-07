import * as XLSX from "xlsx";
import { formatDateTime } from "@/lib/date-format";
import { formatDurationCompact } from "@/lib/format-duration";
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
    ["تقرير الشاحنات اليومي"],
    ["يوم التشغيل", report.operationalDate],
    ["النافذة", report.windowLabelAr],
  ];
  if (report.filters.customerName) {
    rows.push(["فلتر الزبون", report.filters.customerName]);
  }
  if (report.filters.gradeLabelAr) {
    rows.push(["فلتر النخب", report.filters.gradeLabelAr]);
  }
  rows.push([]);
  rows.push(["مسجّلة", report.summary.registered]);
  rows.push(["مكتملة", report.summary.completed]);
  rows.push(["ملغاة", report.summary.cancelled]);
  rows.push(["مفتوحة", report.summary.open]);
  rows.push(["مجموع قبان (طن)", tons(report.summary.totalBridgeTons)]);
  if (canSensitive) {
    rows.push(["مجموع داخلي (طن)", tons(report.summary.totalInternalTons)]);
    rows.push(["مجموع فرق (طن)", tons(report.summary.totalDiscrepancyTons)]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 22 }, { wch: 32 }];
  return sheet;
}

function buildTrucksSheet(report: DailyTrucksReport): XLSX.WorkSheet {
  const canSensitive = report.permissions.canViewSensitiveTonnage;
  const header = [
    "#",
    "اللوحة",
    "السائق",
    "الزبون",
    "الوجهة",
    "أمر البيع",
    "النخب",
    "التسجيل",
    "مدة التحميل الداخلي",
    "الحالة",
    "قبان (طن)",
    ...(canSensitive ? ["داخلي (طن)", "فرق (طن)"] : []),
    "ملاحظة",
  ];

  const body = report.rows.map((row: DailyTruckRow, index: number) => [
    index + 1,
    row.plateNumber,
    row.driverName,
    row.customer?.fullName ?? "—",
    row.destination?.name ?? "—",
    row.salesOrderNumber ?? "—",
    row.gradeLabelAr ?? "—",
    dateTimeOrDash(row.createdAt),
    formatDurationCompact(row.internalLoadingMs),
    row.statusLabelAr,
    tons(row.bridgeTons),
    ...(canSensitive ? [tons(row.internalTons), tons(row.discrepancyTons)] : []),
    row.noteAr ?? "—",
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
  const header = ["القياس", "المجموع الداخلي (طن)", "الربطات", "الشاحنات"];
  const body = report.sizeTotals.map((sizeTotal) => [
    sizeTotal.displayName,
    tons(sizeTotal.totalTons),
    bundles(sizeTotal.totalBundles),
    sizeTotal.truckCount,
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = [{ wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 12 }];
  return sheet;
}

function buildDetailsSheet(report: DailyTrucksReport): XLSX.WorkSheet {
  const header = ["#", "اللوحة", "الزبون", "القياس", "الوزن (طن)", "الربطات"];
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
        item.displayName,
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
  workbook.Workbook = { Views: [{ RTL: true }] };

  XLSX.utils.book_append_sheet(workbook, buildSummarySheet(report), "الملخص");
  XLSX.utils.book_append_sheet(workbook, buildTrucksSheet(report), "الشاحنات");
  XLSX.utils.book_append_sheet(
    workbook,
    buildSizeTotalsSheet(report),
    "المجموع حسب القياس",
  );
  if (options.includeDetails) {
    XLSX.utils.book_append_sheet(
      workbook,
      buildDetailsSheet(report),
      "تفاصيل القياسات",
    );
  }

  XLSX.writeFile(workbook, `daily-trucks-${report.operationalDate}.xlsx`);
}
