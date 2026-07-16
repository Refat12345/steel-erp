import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/date-format";
import {
  DASHBOARD_STATS_CACHE_TAG,
  getAnalyticsStartDateValue,
} from "@/lib/services/settings.service";

/** Cached KPI payload — heavy (12+ DB ops); shared across all authenticated users */
export async function getDashboardStatsCached() {
  // Analytics-start floor for payment EVENTS. `paymentDate` is a date-only
  // column (stored at UTC midnight), so the floor is the calendar date —
  // not the 08:00 operational instant used for timestamped events.
  const analyticsStartValue = await getAnalyticsStartDateValue();
  const paymentFloor =
    analyticsStartValue && /^\d{4}-\d{2}-\d{2}$/.test(analyticsStartValue)
      ? new Date(`${analyticsStartValue}T00:00:00.000Z`)
      : null;

  return unstable_cache(
    async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const paymentDateFloor = paymentFloor
        ? { paymentDate: { gte: paymentFloor } }
        : {};

      const [
        ordersByStatus,
        ordersByKind,
        totalTonsByKind,
        contractsByStatus,
        paymentsByDay,
        topCustomers,
        paymentsByMethod,
        totalPaymentsAmount,
        totalActiveOrders,
        totalActiveContracts,
        totalCustomers,
      ] = await Promise.all([
        prisma.salesOrder.groupBy({
          by: ["status"],
          _count: { status: true },
        }),
        prisma.salesOrder.groupBy({
          by: ["kind"],
          _count: { kind: true },
        }),
        prisma.salesOrder.groupBy({
          by: ["kind"],
          where: { status: { in: ["approved", "in_progress", "completed"] } },
          _sum: { totalQtyTons: true },
        }),
        prisma.masterContract.groupBy({
          by: ["status"],
          _count: { status: true },
        }),
        prisma.payment.findMany({
          where: {
            paymentDate: {
              gte:
                paymentFloor && paymentFloor > thirtyDaysAgo
                  ? paymentFloor
                  : thirtyDaysAgo,
            },
          },
          select: { paymentDate: true, amount: true },
          orderBy: { paymentDate: "asc" },
        }),
        prisma.payment.groupBy({
          by: ["customerId"],
          where: paymentDateFloor,
          _sum: { amount: true },
          orderBy: { _sum: { amount: "desc" } },
          take: 5,
        }),
        prisma.payment.groupBy({
          by: ["method"],
          where: paymentDateFloor,
          _sum: { amount: true },
          _count: { method: true },
        }),
        prisma.payment.aggregate({
          where: paymentDateFloor,
          _sum: { amount: true },
        }),
        prisma.salesOrder.count({
          where: { status: { in: ["approved", "in_progress"] } },
        }),
        prisma.masterContract.count({ where: { status: "active" } }),
        prisma.customer.count({ where: { isActive: true } }),
      ]);

      const customerIds = topCustomers.map((t) => t.customerId);
      const customers = await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, fullName: true, code: true },
      });
      const customerMap = new Map(customers.map((c) => [c.id, c]));

      const dayMap = new Map<string, number>();
      for (const p of paymentsByDay) {
        const key = p.paymentDate.toISOString().slice(0, 10);
        dayMap.set(key, (dayMap.get(key) ?? 0) + Number(p.amount));
      }
      const paymentsTimeline = Array.from(dayMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, total]) => ({
          date,
          label: formatDate(date),
          total,
        }));

      const STATUS_LABELS: Record<string, string> = {
        draft: "مسودة",
        approved: "معتمد",
        in_progress: "قيد التنفيذ",
        completed: "مكتمل",
        cancelled: "ملغى",
      };
      const STATUS_COLORS: Record<string, string> = {
        draft: "#94a3b8",
        approved: "#3b82f6",
        in_progress: "#f59e0b",
        completed: "#10b981",
        cancelled: "#ef4444",
      };
      const KIND_LABELS: Record<string, string> = {
        REBAR: "مبروم",
        SHORTBAR_1_4M: "قصائر 1–4 م",
        SHORTBAR_4_12M: "قصائر 4–12 م",
        SCRAP: "خردة",
        BILLET_WIRE: "أسلاك تربيط",
        REBAR_UNDER_70CM: "مبروم أقل من 70 سم",
        BILLET_SCRAP_10M: "بيلت خردة 10m",
        SCRAP_50CM_1M: "سكراب من 50 سم إلى 1 م",
      };
      const METHOD_LABELS: Record<string, string> = {
        CASH: "نقدي",
        BANK_TRANSFER: "تحويل بنكي",
        CHECK: "شيك",
      };
      const CONTRACT_LABELS: Record<string, string> = {
        active: "نشط",
        suspended: "معلّق",
        closed: "مغلق",
      };

      return {
        kpis: {
          totalPaymentsAmount: Number(totalPaymentsAmount._sum.amount ?? 0),
          activeOrders: totalActiveOrders,
          activeContracts: totalActiveContracts,
          totalCustomers,
        },
        ordersByStatus: ordersByStatus.map((o) => ({
          status: o.status,
          label: STATUS_LABELS[o.status] ?? o.status,
          count: o._count.status,
          color: STATUS_COLORS[o.status] ?? "#94a3b8",
        })),
        ordersByKind: ordersByKind.map((o) => ({
          kind: o.kind,
          label: KIND_LABELS[o.kind] ?? o.kind,
          count: o._count.kind,
        })),
        totalTonsByKind: totalTonsByKind.map((o) => ({
          kind: o.kind,
          label: KIND_LABELS[o.kind] ?? o.kind,
          tons: Number(o._sum.totalQtyTons ?? 0),
        })),
        contractsByStatus: contractsByStatus.map((c) => ({
          status: c.status,
          label: CONTRACT_LABELS[c.status] ?? c.status,
          count: c._count.status,
        })),
        paymentsTimeline,
        topCustomers: topCustomers.map((t) => {
          const cust = customerMap.get(t.customerId);
          return {
            customerId: t.customerId,
            name: cust?.fullName ?? `عميل #${t.customerId}`,
            code: cust?.code ?? "",
            total: Number(t._sum.amount ?? 0),
          };
        }),
        paymentsByMethod: paymentsByMethod.map((m) => ({
          method: m.method,
          label: METHOD_LABELS[m.method] ?? m.method,
          total: Number(m._sum.amount ?? 0),
          count: m._count.method,
        })),
      };
    },
    // Cache key varies with the analytics start so a settings change
    // takes effect immediately; the tag lets the settings write flush it.
    ["dashboard-stats", analyticsStartValue ?? "-"],
    { revalidate: 45, tags: [DASHBOARD_STATS_CACHE_TAG] }
  )();
}
