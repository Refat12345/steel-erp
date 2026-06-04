"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { sessionHasPermission } from "@/lib/client-permissions";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Plus,
  Search,
  Scale,
  ChevronLeft,
  ChevronRight,
  Pencil,
  CalendarDays,
} from "lucide-react";
import { RegisterTruckDialog } from "./register-truck-dialog";
import { EditTruckDialog, type EditableTruck } from "./edit-truck-dialog";
import { durationBetween, formatDurationCompact } from "@/lib/format-duration";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { getDisplayGradeLabel } from "@/lib/truck-grade";
import { canShowTruckEditButton } from "@/lib/truck-edit-ui";
import type { SalesOrderGrade } from "@prisma/client";

interface TruckListItem extends EditableTruck {
  id: number;
  plateNumber: string;
  driverName: string;
  status: string;
  version: number;
  customerId: number | null;
  destinationId: number | null;
  salesOrderNumber: string | null;
  notes: string | null;
  operationalGrade: SalesOrderGrade | null;
  tareWeightKg: string | null;
  grossWeightKg: string | null;
  tareTime: string | null;
  grossTime: string | null;
  createdAt: string;
  closedAt: string | null;
  customer: { id: number; fullName: string; code: string } | null;
  destination: { id: number; name: string; details: string | null } | null;
  creator: { id: number; fullName: string };
  _count: { sessions: number };
}

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  Queued: { label: "بالطابور", variant: "secondary" },
  FirstWeigh: { label: "وزن فارغ", variant: "default" },
  OnScale: { label: "على الميزان", variant: "default" },
  LoadingComplete: { label: "تحميل مكتمل", variant: "outline" },
  SecondWeigh: { label: "وزن محمّل", variant: "default" },
  Completed: { label: "مكتملة", variant: "secondary" },
  Cancelled: { label: "ملغاة", variant: "destructive" },
};

const PAGE_SIZE = 25;

function formatLocalDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dayFilterParams(date: string): { dateFrom: string; dateTo: string } {
  return {
    dateFrom: `${date}T00:00:00.000`,
    dateTo: `${date}T23:59:59.999`,
  };
}

export function TruckList() {
  const { data: session } = useSession();
  const router = useRouter();
  const [data, setData] = useState<TruckListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [plateSearch, setPlateSearch] = useState("");
  const [registrationDate, setRegistrationDate] = useState(() =>
    formatLocalDateInput(new Date()),
  );
  const [showRegister, setShowRegister] = useState(false);
  const [editingTruckId, setEditingTruckId] = useState<number | null>(null);

  const todayDate = formatLocalDateInput(new Date());
  const isTodaySelected = registrationDate === todayDate;

  const canRegister = sessionHasPermission(session, "truck.register");
  const canEditQueued = sessionHasPermission(session, "truck.edit_queued");
  const canEditApproved = sessionHasPermission(session, "truck.edit_approved");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      if (plateSearch.trim()) params.set("plateNumber", plateSearch.trim());
      if (registrationDate) {
        const { dateFrom, dateTo } = dayFilterParams(registrationDate);
        params.set("dateFrom", dateFrom);
        params.set("dateTo", dateTo);
      }

      const res = await fetch(`/api/trucks?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setData(json.data);
      setTotal(json.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ في تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, plateSearch, registrationDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, plateSearch, registrationDate]);

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="بحث برقم اللوحة..."
            className="ps-9"
            value={plateSearch}
            onChange={(e) => setPlateSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="الحالة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">جميع الحالات</SelectItem>
            {Object.entries(statusMap).map(([key, { label }]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="space-y-1">
          <label htmlFor="truck-registration-date" className="text-xs text-muted-foreground">
            تاريخ التسجيل
          </label>
          <div className="flex items-center gap-1">
            <Input
              id="truck-registration-date"
              type="date"
              className="w-[150px]"
              value={registrationDate}
              onChange={(e) => setRegistrationDate(e.target.value)}
            />
            <Button
              type="button"
              variant={isTodaySelected ? "default" : "outline"}
              size="sm"
              className="shrink-0"
              onClick={() => setRegistrationDate(todayDate)}
            >
              <CalendarDays className="h-4 w-4 me-1" />
              اليوم
            </Button>
            {registrationDate && (
              <Badge variant="secondary" className="h-9 px-3 text-sm tabular-nums shrink-0">
                {loading ? "…" : `${total.toLocaleString("ar-SY")} شاحنة`}
              </Badge>
            )}
          </div>
        </div>
        {canRegister && (
          <Button onClick={() => setShowRegister(true)}>
            <Plus className="h-4 w-4 me-1" />
            تسجيل شاحنة
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-x-auto">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">#</TableHead>
              <TableHead>الزبون</TableHead>
              <TableHead>رقم اللوحة</TableHead>
              <TableHead>السائق</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>النخب</TableHead>
              <TableHead>الوجهة</TableHead>
              <TableHead>صافي القبان (كغ)</TableHead>
              <TableHead>مدة التحميل</TableHead>
              <TableHead>التاريخ</TableHead>
              <TableHead className="w-[96px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 11 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                      لا توجد عمليات
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((truck) => {
                    const st = statusMap[truck.status] ?? {
                      label: truck.status,
                      variant: "secondary" as const,
                    };
                    const endTime = truck.grossTime
                      ?? (truck.status === "Cancelled" ? truck.closedAt : null);
                    const loadingInProgress =
                      truck.tareTime != null && endTime == null && truck.status !== "Cancelled";
                    const loadingMs = loadingInProgress
                      ? durationBetween(truck.tareTime, new Date())
                      : durationBetween(truck.tareTime, endTime);
                    const tareKg = truck.tareWeightKg ? Number(truck.tareWeightKg) : null;
                    const grossKg = truck.grossWeightKg ? Number(truck.grossWeightKg) : null;
                    const bridgeNetKg =
                      tareKg != null && grossKg != null ? grossKg - tareKg : null;
                    return (
                      <TableRow
                        key={truck.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => router.push(`/scale/${truck.id}`)}
                      >
                        <TableCell className="font-mono text-xs">
                          {truck.id}
                        </TableCell>
                        <TableCell className="text-sm">
                          {truck.customer?.fullName ?? "—"}
                        </TableCell>
                        <TableCell className="font-medium">
                          {truck.plateNumber}
                        </TableCell>
                        <TableCell>{truck.driverName}</TableCell>
                        <TableCell>
                          <Badge variant={st.variant}>{st.label}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {getDisplayGradeLabel(truck) ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {truck.destination?.name ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {bridgeNetKg != null
                            ? bridgeNetKg.toLocaleString("ar-SY")
                            : "—"}
                        </TableCell>
                        <TableCell
                          className={`font-mono text-sm tabular-nums ${
                            loadingInProgress ? "text-amber-600" : ""
                          }`}
                          title={
                            truck.tareTime
                              ? `دخول القبان فارغاً: ${formatDateTime(truck.tareTime)}${
                                  endTime
                                    ? `\nوزن المحمّل: ${formatDateTime(endTime)}`
                                    : ""
                                }`
                              : ""
                          }
                        >
                          {formatDurationCompact(loadingMs)}
                          {loadingInProgress && (
                            <span className="ms-1 text-[10px] font-sans text-amber-600">
                              (جارٍ)
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(truck.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {canShowTruckEditButton(
                              truck.status,
                              truck._count.sessions,
                              canEditQueued,
                              canEditApproved,
                            ) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title="تعديل"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingTruckId(truck.id);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              title="فتح عملية الوزن"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/scale/${truck.id}`);
                              }}
                            >
                              <Scale className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total > 0
            ? `عرض ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} من ${total}`
            : "لا توجد نتائج"}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="px-2 tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <RegisterTruckDialog
        open={showRegister}
        onOpenChange={setShowRegister}
        onSuccess={fetchData}
      />
      <EditTruckDialog
        truckId={editingTruckId}
        open={editingTruckId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingTruckId(null);
        }}
        onSuccess={fetchData}
      />
    </div>
  );
}
