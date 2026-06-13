import { prisma } from "@/lib/db";
import type { SalesOrderGrade, TruckStatus } from "@prisma/client";
import {
  GRADE_LABELS,
  getDisplayGrade,
} from "@/lib/truck-grade";
import {
  PRODUCT_FILTER_LABELS_AR,
  type ReportProductFilter,
} from "@/lib/material-kind";
import { sliceReportByProductFilter } from "@/lib/report-product-filter";
import {
  OPERATIONAL_DAY_CUTOFF_HOUR,
  REPORT_DISCREPANCY_WARN_TONS,
  computeBridgeTons,
  computeDiscrepancyTons,
  formatLocalDateInput,
  formatOperationalWindowLabel,
  getOperationalDayWindow,
  getReportPeriodWindow,
  resolveReportTonnageStatus,
  type ReportPeriod,
  type ReportTonnageStatus,
} from "@/lib/operational-day";
import { computeTruckTimings } from "@/lib/truck-timing";
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
  /** Rebar grade, combined shortbar, or scrap — null/omitted = all products. */
  productFilter?: ReportProductFilter;
  canViewSensitiveTonnage?: boolean;
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
  internalLoadingMs: number | null;
  bridgeTons: number | null;
  internalTons: number | null;
  discrepancyTons: number | null;
  discrepancyWarning: boolean;
  tonnageStatus: ReportTonnageStatus;
  cancelReason: string | null;
  noteAr: string | null;
  /** True when a grade filter is active and only part of the visit matches. */
  isPartialVisit: boolean;
  sizeBreakdown: DailyTruckSizeBreakdown[];
  /** Per-bridge-round breakdown — populated only for multi-round visits. */
  rounds: DailyTruckRoundBreakdown[];
}

export interface DailyTruckSizeBreakdown {
  sizeId: number | null;
  displayName: string;
  weightTons: number;
  bundleCount: number | null;
}

export interface DailyTruckRoundBreakdown {
  roundNumber: number;
  grade: SalesOrderGrade | null;
  gradeLabelAr: string | null;
  netTons: number | null;
}

export interface DailyTrucksReportSummary {
  registered: number;
  completed: number;
  cancelled: number;
  open: number;
  totalBridgeTons: number;
  totalInternalTons: number | null;
  totalDiscrepancyTons: number | null;
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
    productFilter?: ReportProductFilter;
    productFilterLabelAr?: string;
  };
  summary: DailyTrucksReportSummary;
  sizeTotals: DailyTrucksReportSizeTotal[];
  rows: DailyTruckRow[];
  permissions: {
    canViewSensitiveTonnage: boolean;
  };
}

function buildNote(
  tonnageStatus: ReportTonnageStatus,
  cancelReason: string | null,
  isPartialVisit = false,
): string | null {
  const parts: string[] = [];
  if (tonnageStatus === "excluded_cancelled" && cancelReason?.trim()) {
    parts.push(cancelReason.trim());
  } else {
    const statusNote = TONNAGE_NOTE[tonnageStatus];
    if (statusNote) parts.push(statusNote);
  }
  if (isPartialVisit) {
    parts.push("زيارة مختلطة — يُعرض جزء الفلتر المحدد فقط");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Full session rows for aggregation — preserves size/bundle metadata. */
function resolveReportSessions<
  T extends { bridgeRoundId: number | null },
>(allSessions: T[], matchingRoundIds: ReadonlyArray<number> | null): T[] {
  if (matchingRoundIds == null) return allSessions;
  const idSet = new Set(matchingRoundIds);
  return allSessions.filter(
    (s) => s.bridgeRoundId != null && idSet.has(s.bridgeRoundId),
  );
}

export async function getDailyTrucksReport(
  params: DailyTrucksReportParams,
): Promise<DailyTrucksReport> {
  const canViewSensitiveTonnage = params.canViewSensitiveTonnage === true;
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
  const productFilterMeta =
    params.productFilter != null
      ? {
          productFilter: params.productFilter,
          productFilterLabelAr: PRODUCT_FILTER_LABELS_AR[params.productFilter],
        }
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
      loadingConfirmedAt: true,
      lastReopenedAt: true,
      cancelReason: true,
      operationalGrade: true,
      customer: { select: { id: true, fullName: true, code: true } },
      destination: { select: { id: true, name: true } },
      salesOrder: { select: { grade: true } },
      sessions: {
        select: {
          bridgeRoundId: true,
          sizeId: true,
          bundleCount: true,
          weightTons: true,
          createdAt: true,
          size: { select: { displayName: true, sortOrder: true, code: true } },
        },
      },
      rounds: {
        orderBy: { roundNumber: "asc" },
        select: {
          id: true,
          roundNumber: true,
          grade: true,
          startWeightKg: true,
          endWeightKg: true,
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
  let totalInternalTons = 0;
  let totalDiscrepancyTons = 0;

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

    const fullBridgeTons = computeBridgeTons(truck.grossWeightKg, truck.tareWeightKg);
    const gradeSlice = sliceReportByProductFilter(
      truck,
      params.productFilter ?? null,
      fullBridgeTons,
      truck.sessions,
    );

    if (!gradeSlice.included) {
      return null;
    }

    const bridgeTons = gradeSlice.bridgeTons;
    const internalTons = gradeSlice.internalTons;
    const reportSessions = resolveReportSessions(
      truck.sessions,
      gradeSlice.matchingRoundIds,
    );
    const discrepancyTons = computeDiscrepancyTons(bridgeTons, internalTons);
    const grade = getDisplayGrade(truck);
    const isPartialVisit = gradeSlice.isPartialVisit;
    const discrepancyWarning =
      discrepancyTons != null &&
      Math.abs(discrepancyTons) > REPORT_DISCREPANCY_WARN_TONS;
    const timings = computeTruckTimings({
      createdAt: truck.createdAt,
      closedAt: truck.closedAt,
      status: truck.status,
      loadingConfirmedAt: truck.loadingConfirmedAt,
      lastReopenedAt: truck.lastReopenedAt,
      sessions: truck.sessions.map((session) => ({ createdAt: session.createdAt })),
    });

    summary.registered += 1;
    if (truck.status === "Completed") summary.completed += 1;
    else if (truck.status === "Cancelled") summary.cancelled += 1;
    else summary.open += 1;

    if (tonnageStatus === "included") {
      if (bridgeTons != null) summary.totalBridgeTons += bridgeTons;
      if (internalTons != null) totalInternalTons += internalTons;
      if (discrepancyTons != null) totalDiscrepancyTons += discrepancyTons;

      for (const session of reportSessions) {
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
    const displayInternal =
      canViewSensitiveTonnage && tonnageStatus === "included" ? internalTons : null;
    const displayDiscrepancy =
      canViewSensitiveTonnage && tonnageStatus === "included" ? discrepancyTons : null;

    type SizeBreakdownAcc = DailyTruckSizeBreakdown & { sortOrder: number };
    const breakdownMap = new Map<string, SizeBreakdownAcc>();
    for (const session of reportSessions) {
      const weightTons = Number(session.weightTons);
      if (!Number.isFinite(weightTons)) continue;
      const key = session.sizeId != null ? `id:${session.sizeId}` : "none";
      let acc = breakdownMap.get(key);
      if (!acc) {
        acc = {
          sizeId: session.sizeId,
          displayName: session.size?.displayName ?? "بدون قياس",
          weightTons: 0,
          bundleCount: 0,
          sortOrder: session.size?.sortOrder ?? Number.MAX_SAFE_INTEGER,
        };
        breakdownMap.set(key, acc);
      }
      acc.weightTons += weightTons;
      if (session.bundleCount == null) {
        acc.bundleCount = null;
      } else if (acc.bundleCount != null) {
        acc.bundleCount += session.bundleCount;
      }
    }
    const sizeBreakdown: DailyTruckSizeBreakdown[] = Array.from(breakdownMap.values())
      .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName))
      .map((acc) => ({
        sizeId: acc.sizeId,
        displayName: acc.displayName,
        weightTons: Math.round(acc.weightTons * 1000) / 1000,
        bundleCount: acc.bundleCount,
      }));

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
      internalLoadingMs: timings.internalLoadingMs,
      bridgeTons: displayBridge,
      internalTons: displayInternal,
      discrepancyTons: displayDiscrepancy,
      discrepancyWarning:
        canViewSensitiveTonnage && tonnageStatus === "included" ? discrepancyWarning : false,
      tonnageStatus,
      cancelReason: truck.cancelReason,
      noteAr: buildNote(tonnageStatus, truck.cancelReason, isPartialVisit),
      isPartialVisit,
      sizeBreakdown,
      rounds:
        truck.rounds.length > 1 && tonnageStatus === "included"
          ? truck.rounds.map((r) => ({
              roundNumber: r.roundNumber,
              grade: r.grade,
              gradeLabelAr: r.grade ? GRADE_LABELS[r.grade] : null,
              netTons:
                r.endWeightKg != null
                  ? Math.round(
                      ((Number(r.endWeightKg) - Number(r.startWeightKg)) / 1000) *
                        1000,
                    ) / 1000
                  : null,
            }))
          : [],
    };
  }).filter((row): row is DailyTruckRow => row !== null);

  summary.totalBridgeTons = Math.round(summary.totalBridgeTons * 1000) / 1000;
  summary.totalInternalTons = canViewSensitiveTonnage
    ? Math.round(totalInternalTons * 1000) / 1000
    : null;
  summary.totalDiscrepancyTons = canViewSensitiveTonnage
    ? Math.round(totalDiscrepancyTons * 1000) / 1000
    : null;

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
    filters: { ...customerFilter, ...productFilterMeta },
    summary,
    sizeTotals,
    rows,
    permissions: { canViewSensitiveTonnage },
  };
}

// ─── Daily Loading Summary ────────────────────────────────────────────
// Aggregated view of a single operational day's dispatched trucks:
//   1. By customer  (loads + bridge tons + share %)
//   2. By city      (loads + bridge tons + share %)
//   3. By size within each city (internal session tons, cross-tab)
// Only "included" trucks (completed within the operational window) count.
// Customer/city tons use the official bridge (قبان) weight; the size
// cross-tab uses internal session weights — matching the rest of the
// reporting layer where bridge is the dispatched figure and session
// weights drive the per-size breakdown.

export interface DailyLoadingSummaryParams {
  operationalDate: string;
  period?: ReportPeriod;
  customerId?: number;
  productFilter?: ReportProductFilter;
}

export interface LoadingSummaryByCustomerRow {
  customerId: number | null;
  customerName: string;
  loads: number;
  tons: number;
  sharePct: number;
}

export interface LoadingSummaryByCityRow {
  destinationId: number | null;
  cityName: string;
  loads: number;
  tons: number;
  sharePct: number;
}

export interface LoadingSummarySizeColumn {
  key: string;
  sizeId: number | null;
  code: string | null;
  displayName: string;
}

export interface LoadingSummaryCitySizeRow {
  destinationId: number | null;
  cityName: string;
  sizeTons: Record<string, number>;
  totalTons: number;
}

export interface DailyLoadingSummary {
  operationalDate: string;
  period: ReportPeriod;
  periodStartDate: string;
  periodEndDate: string;
  windowFrom: string;
  windowTo: string;
  windowLabelAr: string;
  cutoffHour: number;
  generatedAt: string;
  filters: {
    customerId?: number;
    customerName?: string;
    productFilter?: ReportProductFilter;
    productFilterLabelAr?: string;
  };
  totals: {
    truckCount: number;
    totalBridgeTons: number;
    totalInternalTons: number;
  };
  byCustomer: LoadingSummaryByCustomerRow[];
  byCity: LoadingSummaryByCityRow[];
  sizeColumns: LoadingSummarySizeColumn[];
  byCitySize: LoadingSummaryCitySizeRow[];
  citySizeColumnTotals: Record<string, number>;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sharePercent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export async function getDailyLoadingSummary(
  params: DailyLoadingSummaryParams,
): Promise<DailyLoadingSummary> {
  const period: ReportPeriod = params.period ?? "daily";
  let window;
  try {
    window = getReportPeriodWindow(params.operationalDate, period);
  } catch {
    throw new ServiceError("تاريخ يوم التشغيل غير صالح", "BAD_REQUEST");
  }
  const periodStartDate = formatLocalDateInput(window.from);
  const periodEndDate = formatLocalDateInput(
    new Date(window.to.getTime() - 24 * 60 * 60 * 1000),
  );

  let customerFilter: { customerId?: number; customerName?: string } = {};
  if (params.customerId != null) {
    const customer = await prisma.customer.findUnique({
      where: { id: params.customerId },
      select: { id: true, fullName: true },
    });
    if (!customer) {
      throw new ServiceError("الزبون غير موجود", "NOT_FOUND");
    }
    customerFilter = { customerId: customer.id, customerName: customer.fullName };
  }
  const productFilterMeta =
    params.productFilter != null
      ? {
          productFilter: params.productFilter,
          productFilterLabelAr: PRODUCT_FILTER_LABELS_AR[params.productFilter],
        }
      : {};

  const trucks = await prisma.truckOperation.findMany({
    where: {
      createdAt: { gte: window.from, lt: window.to },
      ...(params.customerId != null ? { customerId: params.customerId } : {}),
    },
    select: {
      id: true,
      status: true,
      tareWeightKg: true,
      grossWeightKg: true,
      closedAt: true,
      operationalGrade: true,
      customer: { select: { id: true, fullName: true } },
      destination: { select: { id: true, name: true } },
      salesOrder: { select: { grade: true } },
      rounds: {
        orderBy: { roundNumber: "asc" },
        select: {
          id: true,
          grade: true,
          startWeightKg: true,
          endWeightKg: true,
        },
      },
      sessions: {
        select: {
          bridgeRoundId: true,
          sizeId: true,
          weightTons: true,
          size: { select: { code: true, displayName: true, sortOrder: true } },
        },
      },
    },
  });

  type CustomerAcc = { customerId: number | null; customerName: string; loads: number; tons: number };
  type CityAcc = { destinationId: number | null; cityName: string; loads: number; tons: number };
  type SizeColAcc = {
    sizeId: number | null;
    code: string | null;
    displayName: string;
    sortOrder: number;
  };
  type CitySizeAcc = {
    destinationId: number | null;
    cityName: string;
    cityOrder: number;
    sizeTons: Map<string, number>;
    totalTons: number;
  };

  const customerMap = new Map<string, CustomerAcc>();
  const cityMap = new Map<string, CityAcc>();
  const sizeColMap = new Map<string, SizeColAcc>();
  const citySizeMap = new Map<string, CitySizeAcc>();
  const cityOrderMap = new Map<string, number>();

  let truckCount = 0;
  let totalBridgeTons = 0;
  let totalInternalTons = 0;

  for (const truck of trucks) {
    const tonnageStatus = resolveReportTonnageStatus({
      status: truck.status,
      closedAt: truck.closedAt,
      window,
    });
    if (tonnageStatus !== "included") continue;

    const fullBridgeTons = computeBridgeTons(truck.grossWeightKg, truck.tareWeightKg);
    const gradeSlice = sliceReportByProductFilter(
      truck,
      params.productFilter ?? null,
      fullBridgeTons,
      truck.sessions,
    );
    if (!gradeSlice.included) continue;

    const bridgeTons = gradeSlice.bridgeTons ?? 0;
    const internalTons = gradeSlice.internalTons ?? 0;
    const reportSessions = resolveReportSessions(
      truck.sessions,
      gradeSlice.matchingRoundIds,
    );

    truckCount += 1;
    totalBridgeTons += bridgeTons;
    totalInternalTons += internalTons;

    const customerKey = truck.customer ? `id:${truck.customer.id}` : "none";
    let customerAcc = customerMap.get(customerKey);
    if (!customerAcc) {
      customerAcc = {
        customerId: truck.customer?.id ?? null,
        customerName: truck.customer?.fullName ?? "بدون زبون",
        loads: 0,
        tons: 0,
      };
      customerMap.set(customerKey, customerAcc);
    }
    customerAcc.loads += 1;
    customerAcc.tons += bridgeTons;

    const cityKey = truck.destination ? `id:${truck.destination.id}` : "none";
    const cityName = truck.destination?.name ?? "بدون وجهة";
    if (!cityOrderMap.has(cityKey)) cityOrderMap.set(cityKey, cityOrderMap.size);

    let cityAcc = cityMap.get(cityKey);
    if (!cityAcc) {
      cityAcc = {
        destinationId: truck.destination?.id ?? null,
        cityName,
        loads: 0,
        tons: 0,
      };
      cityMap.set(cityKey, cityAcc);
    }
    cityAcc.loads += 1;
    cityAcc.tons += bridgeTons;

    let citySizeAcc = citySizeMap.get(cityKey);
    if (!citySizeAcc) {
      citySizeAcc = {
        destinationId: truck.destination?.id ?? null,
        cityName,
        cityOrder: cityOrderMap.get(cityKey)!,
        sizeTons: new Map<string, number>(),
        totalTons: 0,
      };
      citySizeMap.set(cityKey, citySizeAcc);
    }

    for (const session of reportSessions) {
      const weightTons = Number(session.weightTons);
      if (!Number.isFinite(weightTons)) continue;
      const sizeKey = session.sizeId != null ? `id:${session.sizeId}` : "none";

      if (!sizeColMap.has(sizeKey)) {
        sizeColMap.set(sizeKey, {
          sizeId: session.sizeId,
          code: session.size?.code ?? null,
          displayName: session.size?.displayName ?? "بدون قياس",
          sortOrder: session.size?.sortOrder ?? Number.MAX_SAFE_INTEGER,
        });
      }

      citySizeAcc.sizeTons.set(
        sizeKey,
        (citySizeAcc.sizeTons.get(sizeKey) ?? 0) + weightTons,
      );
      citySizeAcc.totalTons += weightTons;
    }
  }

  const byCustomer: LoadingSummaryByCustomerRow[] = Array.from(customerMap.values())
    .sort((a, b) => b.tons - a.tons || a.customerName.localeCompare(b.customerName, "ar"))
    .map((acc) => ({
      customerId: acc.customerId,
      customerName: acc.customerName,
      loads: acc.loads,
      tons: round3(acc.tons),
      sharePct: sharePercent(acc.tons, totalBridgeTons),
    }));

  const byCity: LoadingSummaryByCityRow[] = Array.from(cityMap.values())
    .sort((a, b) => b.tons - a.tons || a.cityName.localeCompare(b.cityName, "ar"))
    .map((acc) => ({
      destinationId: acc.destinationId,
      cityName: acc.cityName,
      loads: acc.loads,
      tons: round3(acc.tons),
      sharePct: sharePercent(acc.tons, totalBridgeTons),
    }));

  const sizeColumns: LoadingSummarySizeColumn[] = Array.from(sizeColMap.entries())
    .sort(
      ([, a], [, b]) =>
        a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName),
    )
    .map(([key, acc]) => ({
      key,
      sizeId: acc.sizeId,
      code: acc.code,
      displayName: acc.displayName,
    }));

  const byCitySize: LoadingSummaryCitySizeRow[] = Array.from(citySizeMap.values())
    .sort((a, b) => a.cityOrder - b.cityOrder)
    .map((acc) => {
      const sizeTons: Record<string, number> = {};
      for (const col of sizeColumns) {
        const value = acc.sizeTons.get(col.key);
        if (value != null) sizeTons[col.key] = round3(value);
      }
      return {
        destinationId: acc.destinationId,
        cityName: acc.cityName,
        sizeTons,
        totalTons: round3(acc.totalTons),
      };
    });

  const citySizeColumnTotals: Record<string, number> = {};
  for (const col of sizeColumns) {
    let total = 0;
    for (const acc of citySizeMap.values()) {
      total += acc.sizeTons.get(col.key) ?? 0;
    }
    citySizeColumnTotals[col.key] = round3(total);
  }

  return {
    operationalDate: params.operationalDate,
    period,
    periodStartDate,
    periodEndDate,
    windowFrom: window.from.toISOString(),
    windowTo: window.to.toISOString(),
    windowLabelAr: formatOperationalWindowLabel(window),
    cutoffHour: OPERATIONAL_DAY_CUTOFF_HOUR,
    generatedAt: new Date().toISOString(),
    filters: { ...customerFilter, ...productFilterMeta },
    totals: {
      truckCount,
      totalBridgeTons: round3(totalBridgeTons),
      totalInternalTons: round3(totalInternalTons),
    },
    byCustomer,
    byCity,
    sizeColumns,
    byCitySize,
    citySizeColumnTotals,
  };
}
