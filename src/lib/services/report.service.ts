import { prisma } from "@/lib/db";
import type { TruckStatus } from "@prisma/client";
import {
  OPERATIONAL_DAY_CUTOFF_HOUR,
  REPORT_DISCREPANCY_WARN_TONS,
  computeBridgeTons,
  computeDiscrepancyTons,
  computeInternalTons,
  formatOperationalWindowLabel,
  getOperationalDayWindow,
  resolveReportTonnageStatus,
  type ReportTonnageStatus,
} from "@/lib/operational-day";
import { ServiceError } from "./errors";

const TRUCK_STATUS_LABELS: Record<TruckStatus, string> = {
  Queued: "بالطابور",
  Approved: "معتمدة",
  FirstWeigh: "وزن فارغ",
  Loading: "قيد التحميل",
  OnScale: "على الميزان",
  LoadingComplete: "تحميل مكتمل",
  SecondWeigh: "وزن محمّل",
  Completed: "مكتملة",
  Cancelled: "ملغاة",
};

const TONNAGE_NOTE: Record<ReportTonnageStatus, string | null> = {
  included: null,
  excluded_late_close: "اكتملت بعد نهاية يوم التشغيل",
  excluded_cancelled: null,
  excluded_open: "لم تكتمل بعد",
};

export interface DailyTrucksReportParams {
  operationalDate: string;
  customerId?: number;
}

export interface DailyTruckRow {
  id: number;
  plateNumber: string;
  driverName: string;
  customer: { id: number; fullName: string; code: string } | null;
  destination: { id: number; name: string } | null;
  salesOrderNumber: string | null;
  status: TruckStatus;
  statusLabelAr: string;
  createdAt: string;
  closedAt: string | null;
  bridgeTons: number | null;
  internalTons: number | null;
  discrepancyTons: number | null;
  discrepancyWarning: boolean;
  tonnageStatus: ReportTonnageStatus;
  cancelReason: string | null;
  noteAr: string | null;
}

export interface DailyTrucksReportSummary {
  registered: number;
  completed: number;
  cancelled: number;
  open: number;
  totalBridgeTons: number;
  totalInternalTons: number;
  totalDiscrepancyTons: number;
}

export interface DailyTrucksReport {
  operationalDate: string;
  windowFrom: string;
  windowTo: string;
  windowLabelAr: string;
  cutoffHour: number;
  filters: {
    customerId?: number;
    customerName?: string;
  };
  summary: DailyTrucksReportSummary;
  rows: DailyTruckRow[];
}

function buildNote(
  tonnageStatus: ReportTonnageStatus,
  cancelReason: string | null,
): string | null {
  if (tonnageStatus === "excluded_cancelled" && cancelReason?.trim()) {
    return cancelReason.trim();
  }
  return TONNAGE_NOTE[tonnageStatus];
}

export async function getDailyTrucksReport(
  params: DailyTrucksReportParams,
): Promise<DailyTrucksReport> {
  let window;
  try {
    window = getOperationalDayWindow(params.operationalDate);
  } catch {
    throw new ServiceError("تاريخ يوم التشغيل غير صالح", "BAD_REQUEST");
  }

  let customerFilter: { customerId?: number; customerName?: string } = {};
  if (params.customerId != null) {
    const customer = await prisma.customer.findUnique({
      where: { id: params.customerId },
      select: { id: true, fullName: true },
    });
    if (!customer) {
      throw new ServiceError("الزبون غير موجود", "NOT_FOUND");
    }
    customerFilter = {
      customerId: customer.id,
      customerName: customer.fullName,
    };
  }

  const trucks = await prisma.truckOperation.findMany({
    where: {
      createdAt: { gte: window.from, lt: window.to },
      ...(params.customerId != null ? { customerId: params.customerId } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      plateNumber: true,
      driverName: true,
      salesOrderNumber: true,
      status: true,
      tareWeightKg: true,
      grossWeightKg: true,
      createdAt: true,
      closedAt: true,
      cancelReason: true,
      customer: { select: { id: true, fullName: true, code: true } },
      destination: { select: { id: true, name: true } },
      sessions: { select: { weightTons: true } },
    },
  });

  const summary: DailyTrucksReportSummary = {
    registered: 0,
    completed: 0,
    cancelled: 0,
    open: 0,
    totalBridgeTons: 0,
    totalInternalTons: 0,
    totalDiscrepancyTons: 0,
  };

  const rows: DailyTruckRow[] = trucks.map((truck) => {
    const tonnageStatus = resolveReportTonnageStatus({
      status: truck.status,
      closedAt: truck.closedAt,
      window,
    });

    const bridgeTons = computeBridgeTons(truck.grossWeightKg, truck.tareWeightKg);
    const internalTons = computeInternalTons(truck.sessions);
    const discrepancyTons = computeDiscrepancyTons(bridgeTons, internalTons);
    const discrepancyWarning =
      discrepancyTons != null &&
      Math.abs(discrepancyTons) > REPORT_DISCREPANCY_WARN_TONS;

    summary.registered += 1;
    if (truck.status === "Completed") summary.completed += 1;
    else if (truck.status === "Cancelled") summary.cancelled += 1;
    else summary.open += 1;

    if (tonnageStatus === "included") {
      if (bridgeTons != null) summary.totalBridgeTons += bridgeTons;
      if (internalTons != null) summary.totalInternalTons += internalTons;
      if (discrepancyTons != null) summary.totalDiscrepancyTons += discrepancyTons;
    }

    const displayBridge = tonnageStatus === "included" ? bridgeTons : null;
    const displayInternal = tonnageStatus === "included" ? internalTons : null;
    const displayDiscrepancy =
      tonnageStatus === "included" ? discrepancyTons : null;

    return {
      id: truck.id,
      plateNumber: truck.plateNumber,
      driverName: truck.driverName,
      customer: truck.customer,
      destination: truck.destination,
      salesOrderNumber: truck.salesOrderNumber,
      status: truck.status,
      statusLabelAr: TRUCK_STATUS_LABELS[truck.status],
      createdAt: truck.createdAt.toISOString(),
      closedAt: truck.closedAt?.toISOString() ?? null,
      bridgeTons: displayBridge,
      internalTons: displayInternal,
      discrepancyTons: displayDiscrepancy,
      discrepancyWarning:
        tonnageStatus === "included" ? discrepancyWarning : false,
      tonnageStatus,
      cancelReason: truck.cancelReason,
      noteAr: buildNote(tonnageStatus, truck.cancelReason),
    };
  });

  summary.totalBridgeTons = Math.round(summary.totalBridgeTons * 1000) / 1000;
  summary.totalInternalTons = Math.round(summary.totalInternalTons * 1000) / 1000;
  summary.totalDiscrepancyTons =
    Math.round(summary.totalDiscrepancyTons * 1000) / 1000;

  return {
    operationalDate: params.operationalDate,
    windowFrom: window.from.toISOString(),
    windowTo: window.to.toISOString(),
    windowLabelAr: formatOperationalWindowLabel(window),
    cutoffHour: OPERATIONAL_DAY_CUTOFF_HOUR,
    filters: customerFilter,
    summary,
    rows,
  };
}
