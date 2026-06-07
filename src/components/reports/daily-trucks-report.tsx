"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Loader2,
  RefreshCw,
  Truck,
} from "lucide-react";
import { sessionHasPermission } from "@/lib/client-permissions";
import { formatDateTime } from "@/lib/date-format";
import { formatDurationCompact } from "@/lib/format-duration";
import { defaultOperationalDateInput } from "@/lib/operational-day";
import type { DailyTrucksReport, DailyTruckRow } from "@/lib/services/report.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";

interface CustomerOption {
  id: number;
  code: string;
  fullName: string;
}

const STATUS_BADGE: Record<
  DailyTruckRow["tonnageStatus"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  included: "secondary",
  excluded_late_close: "outline",
  excluded_cancelled: "destructive",
  excluded_open: "default",
};

const GRADE_OPTIONS = [
  { value: "FIRST", label: "نخب أول" },
  { value: "SECOND", label: "نخب ثاني" },
] as const;

function formatTons(value: number | null): string {
  if (value == null) return "—";
  return value.toFixed(3);
}

function formatBundles(value: number | null): string {
  if (value == null) return "—";
  return String(value);
}

function formatNullableDateTime(iso: string | null): string {
  if (!iso) return "—";
  return formatDateTime(iso);
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold tabular-nums">{value}</p>
        {sub ? <p className="text-xs text-muted-foreground mt-1">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

export function DailyTrucksReportView() {
  const { data: session, status } = useSession();
  const canView = sessionHasPermission(session, "report.daily_trucks");

  const [operationalDate, setOperationalDate] = useState(() =>
    defaultOperationalDateInput(),
  );
  const [customerId, setCustomerId] = useState<string>("all");
  const [grade, setGrade] = useState<string>("all");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [report, setReport] = useState<DailyTrucksReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCustomers(true);
      try {
        const res = await fetch("/api/customers?active=true&pageSize=100");
        const json = await res.json();
        if (!cancelled && json.success && Array.isArray(json.data)) {
          setCustomers(json.data);
        }
      } catch {
        if (!cancelled) toast.error("تعذّر تحميل قائمة الزبائن");
      } finally {
        if (!cancelled) setLoadingCustomers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchReport = useCallback(async () => {
    if (!operationalDate) {
      toast.error("اختر تاريخ يوم التشغيل");
      return;
    }
    setLoadingReport(true);
    try {
      const params = new URLSearchParams({ date: operationalDate });
      if (customerId !== "all") params.set("customerId", customerId);
      if (grade !== "all") params.set("grade", grade);
      const res = await fetch(`/api/reports/daily-trucks?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json.error ?? "تعذّر تحميل التقرير");
        setReport(null);
        return;
      }
      setReport(json.data as DailyTrucksReport);
    } catch {
      toast.error("تعذّر تحميل التقرير");
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, [operationalDate, customerId, grade]);

  useEffect(() => {
    if (status === "authenticated" && canView) {
      void fetchReport();
    }
  }, [canView, fetchReport, status]);

  if (status === "loading") {
    return (
      <div className="flex-1 p-4 sm:p-6 space-y-6 min-w-0 max-w-full">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">لا تملك صلاحية عرض هذا التقرير</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 sm:p-6 space-y-6 min-w-0 max-w-full">
      <div className="flex flex-wrap items-start gap-3 min-w-0">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="h-4 w-4" />
          التقارير
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 min-w-0">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "oklch(0.650 0.140 30 / 12%)",
            boxShadow: "inset 0 0 0 1px oklch(0.650 0.140 30 / 25%)",
          }}
        >
          <BarChart3 className="h-5 w-5" style={{ color: "oklch(0.650 0.140 30)" }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">تقرير الشاحنات اليومي</h1>
          <p className="text-sm text-muted-foreground">
            يوم التشغيل من 08:00 إلى 08:00 (Asia/Damascus)
          </p>
          {report ? (
            <p className="text-xs text-muted-foreground mt-1">{report.windowLabelAr}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 min-w-0">
        <div className="space-y-1.5 min-w-[10rem]">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            تاريخ يوم التشغيل
          </label>
          <Input
            type="date"
            value={operationalDate}
            onChange={(e) => setOperationalDate(e.target.value)}
            className="w-full min-w-[10rem]"
          />
        </div>

        <div className="space-y-1.5 min-w-[12rem] flex-1 sm:max-w-xs">
          <label className="text-xs font-medium text-muted-foreground">الزبون</label>
          <Select
            value={customerId}
            onValueChange={(v) => setCustomerId(v ?? "all")}
            disabled={loadingCustomers}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="كل الزبائن" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الزبائن</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.code} — {c.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 min-w-[10rem]">
          <label className="text-xs font-medium text-muted-foreground">النخب</label>
          <Select value={grade} onValueChange={(v) => setGrade(v ?? "all")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="كل النخب" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل النخب</SelectItem>
              {GRADE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button onClick={() => void fetchReport()} disabled={loadingReport}>
          {loadingReport ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="mr-2">عرض التقرير</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setOperationalDate(defaultOperationalDateInput());
            setCustomerId("all");
            setGrade("all");
          }}
        >
          مسح الفلاتر
        </Button>
      </div>

      {loadingReport && !report ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : report ? (
        <>
          {(() => {
            const canViewSensitiveTonnage = report.permissions.canViewSensitiveTonnage;
            const rowColSpan = canViewSensitiveTonnage ? 14 : 12;
            return (
              <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 min-w-0">
            <SummaryCard label="مسجّلة" value={report.summary.registered} />
            <SummaryCard label="مكتملة" value={report.summary.completed} />
            <SummaryCard label="ملغاة" value={report.summary.cancelled} />
            <SummaryCard label="مفتوحة" value={report.summary.open} />
            <SummaryCard
              label="مجموع قبان"
              value={formatTons(report.summary.totalBridgeTons)}
              sub="طن"
            />
            {canViewSensitiveTonnage ? (
              <>
                <SummaryCard
                  label="مجموع داخلي"
                  value={formatTons(report.summary.totalInternalTons)}
                  sub="طن"
                />
                <SummaryCard
                  label="مجموع فرق"
                  value={formatTons(report.summary.totalDiscrepancyTons)}
                  sub="طن"
                />
              </>
            ) : null}
          </div>

          {report.filters.customerName ? (
            <p className="text-sm text-muted-foreground">
              فلتر الزبون: <span className="font-medium">{report.filters.customerName}</span>
            </p>
          ) : null}
          {report.filters.gradeLabelAr ? (
            <p className="text-sm text-muted-foreground">
              فلتر النخب: <span className="font-medium">{report.filters.gradeLabelAr}</span>
            </p>
          ) : null}

          <Card className="shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div>
                <h2 className="text-base font-semibold">المجموع حسب القياس</h2>
                <p className="text-xs text-muted-foreground">
                  محسوب من أوزان الجلسات الداخلية للشاحنات المكتملة ضمن يوم التشغيل
                </p>
              </div>
              <div className="rounded-lg border overflow-x-auto min-w-0">
                <Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>القياس</TableHead>
                      <TableHead className="text-left">المجموع الداخلي</TableHead>
                      <TableHead className="text-left">الربطات</TableHead>
                      <TableHead className="text-left">الشاحنات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.sizeTotals.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-center py-8 text-muted-foreground"
                        >
                          لا توجد أوزان داخلية مجمّعة حسب القياس لهذا اليوم
                        </TableCell>
                      </TableRow>
                    ) : (
                      report.sizeTotals.map((sizeTotal) => (
                        <TableRow key={sizeTotal.sizeId ?? "none"}>
                          <TableCell className="font-medium">
                            {sizeTotal.displayName}
                          </TableCell>
                          <TableCell className="font-mono tabular-nums text-left">
                            {formatTons(sizeTotal.totalTons)}
                          </TableCell>
                          <TableCell className="font-mono tabular-nums text-left">
                            {formatBundles(sizeTotal.totalBundles)}
                          </TableCell>
                          <TableCell className="font-mono tabular-nums text-left">
                            {sizeTotal.truckCount}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="rounded-lg border overflow-x-auto min-w-0">
            <Table className={canViewSensitiveTonnage ? "min-w-[1080px]" : "min-w-[920px]"}>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-center">#</TableHead>
                  <TableHead>اللوحة</TableHead>
                  <TableHead>السائق</TableHead>
                  <TableHead>الزبون</TableHead>
                  <TableHead>الوجهة</TableHead>
                  <TableHead>أمر البيع</TableHead>
                  <TableHead>النخب</TableHead>
                  <TableHead>التسجيل</TableHead>
                  <TableHead>مدة التحميل الداخلي</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-left">قبان</TableHead>
                  {canViewSensitiveTonnage ? (
                    <>
                      <TableHead className="text-left">داخلي</TableHead>
                      <TableHead className="text-left">فرق</TableHead>
                    </>
                  ) : null}
                  <TableHead>ملاحظة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={rowColSpan}
                      className="text-center py-10 text-muted-foreground"
                    >
                      لا توجد شاحنات مسجّلة في هذا اليوم التشغيلي
                    </TableCell>
                  </TableRow>
                ) : (
                  report.rows.map((row, index) => (
                    <TableRow
                      key={row.id}
                      className={
                        row.tonnageStatus === "excluded_cancelled"
                          ? "bg-destructive/5"
                          : undefined
                      }
                    >
                      <TableCell className="text-center tabular-nums">{index + 1}</TableCell>
                      <TableCell className="font-mono font-medium">{row.plateNumber}</TableCell>
                      <TableCell>{row.driverName}</TableCell>
                      <TableCell>
                        {row.customer ? (
                          <span className="truncate block max-w-[8rem] sm:max-w-none">
                            {row.customer.fullName}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>{row.destination?.name ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.salesOrderNumber ?? "—"}
                      </TableCell>
                      <TableCell>{row.gradeLabelAr ?? "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatNullableDateTime(row.createdAt)}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums whitespace-nowrap">
                        {formatDurationCompact(row.internalLoadingMs)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE[row.tonnageStatus]}>
                          {row.statusLabelAr}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono tabular-nums text-left">
                        {formatTons(row.bridgeTons)}
                      </TableCell>
                      {canViewSensitiveTonnage ? (
                        <>
                          <TableCell className="font-mono tabular-nums text-left">
                            {formatTons(row.internalTons)}
                          </TableCell>
                          <TableCell
                            className={`font-mono tabular-nums text-left ${
                              row.discrepancyWarning ? "text-red-600 font-semibold" : ""
                            }`}
                          >
                            {formatTons(row.discrepancyTons)}
                          </TableCell>
                        </>
                      ) : null}
                      <TableCell className="text-xs text-muted-foreground max-w-[10rem]">
                        {row.noteAr ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
              </>
            );
          })()}
        </>
      ) : null}
    </div>
  );
}

export function ReportsIndexView() {
  const { data: session } = useSession();
  const canDailyTrucks = sessionHasPermission(session, "report.daily_trucks");

  return (
    <div className="flex-1 p-4 sm:p-6 space-y-6 min-w-0 max-w-full">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "oklch(0.650 0.140 30 / 12%)",
            boxShadow: "inset 0 0 0 1px oklch(0.650 0.140 30 / 25%)",
          }}
        >
          <BarChart3 className="h-5 w-5" style={{ color: "oklch(0.650 0.140 30)" }} />
        </div>
        <div>
          <h1 className="text-xl font-bold">التقارير</h1>
          <p className="text-sm text-muted-foreground">تقارير التشغيل والشاحنات</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
        {canDailyTrucks ? (
          <Link href="/reports/daily-trucks" className="block min-w-0">
            <Card className="h-full shadow-sm transition-colors hover:bg-muted/40">
              <CardContent className="flex items-start gap-4 p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Truck className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold">تقرير الشاحنات اليومي</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    شاحنات يوم التشغيل (8ص→8ص) — قبان ومدة التحميل
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
