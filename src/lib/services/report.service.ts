import { prisma } from "@/lib/db";
import type { SalesOrderGrade, TruckStatus } from "@prisma/client";
import { GRADE_LABELS, getDisplayGrade } from "@/lib/truck-grade";
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
  grade?: SalesOrderGrade;
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
  grade: SalesOrderGrade | null;
  gradeLabelAr: string | null;
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

export interface DailyTrucksReportSizeTotal {
  sizeId: number | null;
  displayName: string;
  totalTons: number;
  totalBundles: number | null;
  truckCount: number;
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
    grade?: SalesOrderGrade;
    gradeLabelAr?: string;
  };
  summary: DailyTrucksReportSummary;
  sizeTotals: DailyTrucksReportSizeTotal[];
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
  const gradeFilter =
    params.grade != null
      ? { grade: params.grade, gradeLabelAr: GRADE_LABELS[params.grade] }
      : {};

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
      operationalGrade: true,
      customer: { select: { id: true, fullName: true, code: true } },
      destination: { select: { id: true, name: true } },
      salesOrder: { select: { grade: true } },
      sessions: {
        select: {
          sizeId: true,
          bundleCount: true,
          weightTons: true,
          size: { select: { displayName: true, sortOrder: true } },
        },
      },
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

  type SizeTotalAcc = {
    sizeId: number | null;
    displayName: string;
    sortOrder: number;
    totalTons: number;
    totalBundles: number;
    anyMissingBundle: boolean;
    truckIds: Set<number>;
  };
  const sizeTotalMap = new Map<string, SizeTotalAcc>();

  const rows: DailyTruckRow[] = trucks.map((truck) => {
    const tonnageStatus = resolveReportTonnageStatus({
      status: truck.status,
      closedAt: truck.closedAt,
      window,
    });

    const bridgeTons = computeBridgeTons(truck.grossWeightKg, truck.tareWeightKg);
    const internalTons = computeInternalTons(truck.sessions);
    const discrepancyTons = computeDiscrepancyTons(bridgeTons, internalTons);
    const grade = getDisplayGrade(truck);
    const discrepancyWarning =
      discrepancyTons != null &&
      Math.abs(discrepancyTons) > REPORT_DISCREPANCY_WARN_TONS;

    if (params.grade != null && grade !== params.grade) {
      return null;
    }

    summary.registered += 1;
    if (truck.status === "Completed") summary.completed += 1;
    else if (truck.status === "Cancelled") summary.cancelled += 1;
    else summary.open += 1;

    if (tonnageStatus === "included") {
      if (bridgeTons != null) summary.totalBridgeTons += bridgeTons;
      if (internalTons != null) summary.totalInternalTons += internalTons;
      if (discrepancyTons != null) summary.totalDiscrepancyTons += discrepancyTons;

      for (const session of truck.sessions) {
        const weightTons = Number(session.weightTons);
        if (!Number.isFinite(weightTons)) continue;

        const key = session.sizeId != null ? `id:${session.sizeId}` : "none";
        let acc = sizeTotalMap.get(key);
        if (!acc) {
          acc = {
            sizeId: session.sizeId,
            displayName: session.size?.displayName ?? "بدون قياس",
            sortOrder: session.size?.sortOrder ?? Number.MAX_SAFE_INTEGER,
            totalTons: 0,
            totalBundles: 0,
            anyMissingBundle: false,
            truckIds: new Set<number>(),
          };
          sizeTotalMap.set(key, acc);
        }

        acc.totalTons += weightTons;
        acc.truckIds.add(truck.id);
        if (session.bundleCount == null) {
          acc.anyMissingBundle = true;
        } else {
          acc.totalBundles += session.bundleCount;
        }
      }
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
      grade,
      gradeLabelAr: grade ? GRADE_LABELS[grade] : null,
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
  }).filter((row): row is DailyTruckRow => row !== null);

  summary.totalBridgeTons = Math.round(summary.totalBridgeTons * 1000) / 1000;
  summary.totalInternalTons = Math.round(summary.totalInternalTons * 1000) / 1000;
  summary.totalDiscrepancyTons =
    Math.round(summary.totalDiscrepancyTons * 1000) / 1000;

  const sizeTotals: DailyTrucksReportSizeTotal[] = Array.from(sizeTotalMap.values())
    .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName))
    .map((acc) => ({
      sizeId: acc.sizeId,
      displayName: acc.displayName,
      totalTons: Math.round(acc.totalTons * 1000) / 1000,
      totalBundles: acc.anyMissingBundle ? null : acc.totalBundles,
      truckCount: acc.truckIds.size,
    }));

  return {
    operationalDate: params.operationalDate,
    windowFrom: window.from.toISOString(),
    windowTo: window.to.toISOString(),
    windowLabelAr: formatOperationalWindowLabel(window),
    cutoffHour: OPERATIONAL_DAY_CUTOFF_HOUR,
    filters: { ...customerFilter, ...gradeFilter },
    summary,
    sizeTotals,
    rows,
  };
}
