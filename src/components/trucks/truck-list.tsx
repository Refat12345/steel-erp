"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
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
import { formatInteger } from "@/lib/number-format";
import { defaultOperationalDateInput } from "@/lib/operational-day";
import { getDisplayGrade } from "@/lib/truck-grade";
import { canShowTruckEditButton } from "@/lib/truck-edit-ui";
import { getTextDirection, type Locale } from "@/i18n/config";
import type { SalesOrderGrade, TruckStatus } from "@prisma/client";

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
  externalCardNumber: string | null;
  customer: { id: number; fullName: string; code: string } | null;
  destination: { id: number; name: string; details: string | null } | null;
  creator: { id: number; fullName: string };
  _count: { sessions: number; rounds: number };
}

const TRUCK_STATUSES: TruckStatus[] = [
  "Queued",
  "Approved",
  "FirstWeigh",
  "Loading",
  "OnScale",
  "LoadingComplete",
  "SecondWeigh",
  "Completed",
  "Cancelled",
];

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  Queued: "secondary",
  Approved: "secondary",
  FirstWeigh: "default",
  Loading: "default",
  OnScale: "default",
  LoadingComplete: "outline",
  SecondWeigh: "default",
  Completed: "secondary",
  Cancelled: "destructive",
};

const PAGE_SIZE = 25;

export function TruckList() {
  const t = useTranslations("trucks");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const isRtl = getTextDirection(locale) === "rtl";
  const { data: session } = useSession();
  const router = useRouter();
  const [data, setData] = useState<TruckListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [plateSearch, setPlateSearch] = useState("");
  const [operationalDate, setOperationalDate] = useState(() =>
    defaultOperationalDateInput(),
  );
  const [showRegister, setShowRegister] = useState(false);
  const [editingTruckId, setEditingTruckId] = useState<number | null>(null);
  const [analyticsStartDate, setAnalyticsStartDate] = useState<string | null>(null);

  const todayOperationalDate = defaultOperationalDateInput();
  const isTodaySelected = operationalDate === todayOperationalDate;

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
      if (operationalDate) params.set("operationalDate", operationalDate);

      const res = await fetch(`/api/trucks?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setData(json.data);
      setTotal(json.total);
      setAnalyticsStartDate(json.analyticsStartDate ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, plateSearch, operationalDate, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, plateSearch, operationalDate]);

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  function statusLabel(status: string): string {
    if ((TRUCK_STATUSES as readonly string[]).includes(status)) {
      return tEnums(`truckStatus.${status as TruckStatus}`);
    }
    return status;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-xl border bg-card/70 p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          {/* Search */}
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
            <label
              htmlFor="truck-plate-search"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("search")}
            </label>
            <div className="relative">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="truck-plate-search"
                placeholder={t("searchPlatePlaceholder")}
                className="ps-9"
                value={plateSearch}
                onChange={(e) => setPlateSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Status */}
          <div className="flex w-full flex-col gap-1.5 sm:w-[11rem]">
            <label className="text-xs font-medium text-muted-foreground">
              {t("status")}
            </label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allStatuses")}</SelectItem>
                {TRUCK_STATUSES.map((key) => (
                  <SelectItem key={key} value={key}>
                    {tEnums(`truckStatus.${key}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Operational day */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <label
                htmlFor="truck-operational-date"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("operationalDay")}
              </label>
              <span className="text-[11px] text-muted-foreground">
                {t("operationalDayHint")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="truck-operational-date"
                type="date"
                className="w-[10.5rem] shrink-0"
                value={operationalDate}
                min={analyticsStartDate ?? undefined}
                onChange={(e) => setOperationalDate(e.target.value)}
              />
              <Button
                type="button"
                variant={isTodaySelected ? "default" : "outline"}
                className="shrink-0"
                onClick={() => setOperationalDate(defaultOperationalDateInput())}
              >
                <CalendarDays className="h-4 w-4 me-1" />
                {t("today")}
              </Button>
            </div>
          </div>

          {/* Count */}
          {operationalDate && (
            <Badge
              variant="secondary"
              className="h-10 px-3 text-sm tabular-nums shrink-0"
            >
              {loading ? "…" : t("truckCount", { count: formatInteger(total) })}
            </Badge>
          )}

          {/* Register */}
          {canRegister && (
            <Button className="shrink-0" onClick={() => setShowRegister(true)}>
              <Plus className="h-4 w-4 me-1" />
              {t("registerTruck")}
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-x-auto">
        <Table className="min-w-[920px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">{t("columns.id")}</TableHead>
              <TableHead>{t("columns.cardNumber")}</TableHead>
              <TableHead>{t("columns.customer")}</TableHead>
              <TableHead>{t("columns.plateNumber")}</TableHead>
              <TableHead>{t("columns.driver")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead>{t("columns.grade")}</TableHead>
              <TableHead>{t("columns.destination")}</TableHead>
              <TableHead>{t("columns.bridgeNetKg")}</TableHead>
              <TableHead>{t("columns.loadingDuration")}</TableHead>
              <TableHead>{t("columns.date")}</TableHead>
              <TableHead className="w-[96px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 12 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                      {t("emptyOperations")}
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((truck) => {
                    const variant = STATUS_VARIANTS[truck.status] ?? "secondary";
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
                    const grade = getDisplayGrade(truck);
                    const durationTitle = truck.tareTime
                      ? [
                          t("tareEntryTitle", { time: formatDateTime(truck.tareTime) }),
                          endTime
                            ? t("grossWeighTitle", { time: formatDateTime(endTime) })
                            : null,
                        ]
                          .filter(Boolean)
                          .join("\n")
                      : "";
                    return (
                      <TableRow
                        key={truck.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => router.push(`/scale/${truck.id}`)}
                      >
                        <TableCell className="font-mono text-xs">
                          {truck.id}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {truck.externalCardNumber ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {truck.customer?.fullName ?? "—"}
                        </TableCell>
                        <TableCell className="font-medium">
                          {truck.plateNumber}
                        </TableCell>
                        <TableCell>{truck.driverName}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Badge variant={variant}>{statusLabel(truck.status)}</Badge>
                            {(truck._count?.rounds ?? 0) > 1 && (
                              <Badge
                                variant="outline"
                                className="border-violet-300 text-violet-700"
                                title={t("roundsBadgeTitle")}
                              >
                                {t("roundsBadge", { count: truck._count.rounds })}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {grade ? tEnums(`grade.${grade}`) : "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {truck.destination?.name ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {bridgeNetKg != null ? formatInteger(bridgeNetKg) : "—"}
                        </TableCell>
                        <TableCell
                          className={`font-mono text-sm tabular-nums ${
                            loadingInProgress ? "text-amber-600" : ""
                          }`}
                          title={durationTitle}
                        >
                          {formatDurationCompact(loadingMs)}
                          {loadingInProgress && (
                            <span className="ms-1 text-[10px] font-sans text-amber-600">
                              {t("loadingInProgress")}
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
                                title={t("edit")}
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
                              title={t("openScale")}
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
            ? t("paginationRange", {
                from: (page - 1) * PAGE_SIZE + 1,
                to: Math.min(page * PAGE_SIZE, total),
                total,
              })
            : t("emptyResults")}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {isRtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
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
            {isRtl ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
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
