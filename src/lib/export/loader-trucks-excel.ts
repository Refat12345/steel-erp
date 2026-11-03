import * as XLSX from "xlsx";
import { formatDateTime } from "@/lib/date-format";
import type { LoaderTrucksReport } from "@/lib/services/report.service";

export interface LoaderTrucksExcelLabels {
  title: string;
  from: string;
  to: string;
  generated: string;
  window: string;
  employees: string;
  /** Distinct-visit total. A visit confirmed by two people counts once. */
  distinctTrucks: string;
  /** Per-employee truck column. */
  trucks: string;
  rounds: string;
  employee: string;
  plate: string;
  round: string;
  confirmedAt: string;
  summarySheet: string;
  detailSheet: string;
}

function sheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim();
  return (cleaned || "Sheet").slice(0, 31);
}

function buildSummarySheet(
  report: LoaderTrucksReport,
  labels: LoaderTrucksExcelLabels,
): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    [labels.title],
    [labels.from, report.fromDate],
    [labels.to, report.toDate],
    [labels.generated, formatDateTime(report.generatedAt)],
    [labels.window, report.windowLabel],
    [labels.employees, report.totals.loaderCount],
    [labels.distinctTrucks, report.totals.truckCount],
    [labels.rounds, report.totals.roundCount],
    [],
    [labels.employee, labels.trucks, labels.rounds],
    ...report.loaders.map((row) => [row.fullName, row.truckCount, row.roundCount]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 28 }, { wch: 22 }, { wch: 14 }];
  return sheet;
}

function buildDetailSheet(
  report: LoaderTrucksReport,
  labels: LoaderTrucksExcelLabels,
): XLSX.WorkSheet {
  const header = [labels.employee, labels.plate, labels.round, labels.confirmedAt];
  const body = report.loaders.flatMap((loader) =>
    loader.rounds.map((round) => [
      loader.fullName,
      round.plateNumber,
      round.roundNumber,
      formatDateTime(round.loadingConfirmedAt),
    ]),
  );
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 22 }];
  return sheet;
}

export function exportLoaderTrucksExcel(
  report: LoaderTrucksReport,
  labels: LoaderTrucksExcelLabels,
): void {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    buildSummarySheet(report, labels),
    sheetName(labels.summarySheet),
  );
  XLSX.utils.book_append_sheet(
    workbook,
    buildDetailSheet(report, labels),
    sheetName(labels.detailSheet),
  );
  XLSX.writeFile(
    workbook,
    `loader-trucks-${report.fromDate}_${report.toDate}.xlsx`,
  );
}
