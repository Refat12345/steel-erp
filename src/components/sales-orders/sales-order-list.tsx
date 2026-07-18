"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { sessionHasPermission } from "@/lib/client-permissions";
import { formatDate } from "@/lib/date-format";
import { formatDecimal } from "@/lib/number-format";
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
  Eye,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { getTextDirection, type Locale } from "@/i18n/config";

export interface SalesOrder {
  orderNumber: string;
  contractNumber: string;
  kind: string;
  grade: string | null;
  settlementMode: string;
  totalQtyTons: string;
  toleranceType: string;
  toleranceValue: string;
  specialRatioPct: string | null;
  status: string;
  createdAt: string;
  contract: {
    contractNumber: string;
    customer: { id: number; code: string; fullName: string };
  };
  _count: { items: number };
}

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive"
> = {
  draft: "secondary",
  approved: "default",
  in_progress: "default",
  completed: "secondary",
  cancelled: "destructive",
};

const STATUS_FILTER_VALUES = [
  "draft",
  "approved",
  "in_progress",
  "completed",
  "cancelled",
] as const;

const KIND_FILTER_VALUES = [
  "REBAR",
  "SHORTBAR_1_4M",
  "SHORTBAR_4_12M",
  "SCRAP",
  "BILLET_WIRE",
  "REBAR_UNDER_70CM",
  "BILLET_SCRAP_10M",
  "SCRAP_50CM_1M",
] as const;

export function SalesOrderList() {
  const t = useTranslations("salesOrders");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
  const isRtl = dir === "rtl";
  const { data: session } = useSession();
  const canCreateSalesOrder = sessionHasPermission(session, "salesorder.create");
  const router = useRouter();
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize],
  );

  const formatKindDisplay = useCallback(
    (kind: string, grade: string | null): string => {
      const k = (KIND_FILTER_VALUES as readonly string[]).includes(kind)
        ? tEnums(`materialKind.${kind as (typeof KIND_FILTER_VALUES)[number]}`)
        : kind;
      if (!grade) return k;
      const g =
        grade === "FIRST" || grade === "SECOND"
          ? tEnums(`grade.${grade}`)
          : grade;
      return t("kindWithGrade", { kind: k, grade: g });
    },
    [t, tEnums],
  );

  const statusLabel = useCallback(
    (status: string): string => {
      return (STATUS_FILTER_VALUES as readonly string[]).includes(status)
        ? tEnums(
            `salesOrderStatus.${status as (typeof STATUS_FILTER_VALUES)[number]}`,
          )
        : status;
    },
    [tEnums],
  );

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (kindFilter !== "all") params.set("kind", kindFilter);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/sales-orders?${params}`);
      const json = await res.json();
      if (json.success) {
        setOrders(json.data);
        setTotal(json.total);
      }
    } catch {
      toast.error(t("errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [search, page, statusFilter, kindFilter, t]);

  useEffect(() => {
    const timer = setTimeout(fetchOrders, 300);
    return () => clearTimeout(timer);
  }, [fetchOrders]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pe-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v ?? "all");
            setPage(1);
          }}
        >
          <SelectTrigger size="sm" className="min-w-[160px]">
            <SelectValue placeholder={t("statusPlaceholder")} />
          </SelectTrigger>
          <SelectContent dir={dir}>
            <SelectItem value="all">{t("allStatuses")}</SelectItem>
            {STATUS_FILTER_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {tEnums(`salesOrderStatus.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={kindFilter}
          onValueChange={(v) => {
            setKindFilter(v ?? "all");
            setPage(1);
          }}
        >
          <SelectTrigger size="sm" className="min-w-[180px]">
            <SelectValue placeholder={t("kindPlaceholder")} />
          </SelectTrigger>
          <SelectContent dir={dir}>
            <SelectItem value="all">{t("allKinds")}</SelectItem>
            {KIND_FILTER_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {tEnums(`materialKind.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canCreateSalesOrder && (
          <Button onClick={() => router.push("/sales-orders/new")} size="sm">
            <Plus className="h-4 w-4" />
            {t("newSalesOrder")}
          </Button>
        )}
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table className="min-w-[700px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">{t("columns.orderNumber")}</TableHead>
              <TableHead>{t("columns.customer")}</TableHead>
              <TableHead className="min-w-[140px]">{t("columns.kind")}</TableHead>
              <TableHead className="w-28">{t("columns.qtyTons")}</TableHead>
              <TableHead className="w-28">{t("columns.status")}</TableHead>
              <TableHead className="w-24 text-center">
                {t("columns.priceItems")}
              </TableHead>
              <TableHead className="w-36">{t("columns.createdAt")}</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-32 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <ClipboardList className="h-8 w-8 opacity-40" />
                    {search || statusFilter !== "all" || kindFilter !== "all"
                      ? t("emptyNoResults")
                      : t("emptyNoOrders")}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              orders.map((o) => {
                const variant = STATUS_VARIANTS[o.status] ?? "secondary";
                return (
                  <TableRow key={o.orderNumber}>
                    <TableCell className="font-mono font-semibold">
                      {o.orderNumber}
                    </TableCell>
                    <TableCell className="font-medium">
                      {o.contract.customer.fullName}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatKindDisplay(o.kind, o.grade)}
                    </TableCell>
                    <TableCell className="font-mono text-sm tabular-nums weight-value">
                      {formatDecimal(o.totalQtyTons, 3)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={variant}>{statusLabel(o.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {o._count.items}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(o.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          router.push(`/sales-orders/${o.orderNumber}`)
                        }
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {total > pageSize && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {isRtl ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
            {t("previous")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t("pageOf", { page, totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("next")}
            {isRtl ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
