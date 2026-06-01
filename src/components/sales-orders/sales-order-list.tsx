"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Eye,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

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

const kindLabels: Record<string, string> = {
  REBAR: "مبروم",
  SHORTBAR_1_4M: "قصائر 1–4 م",
  SHORTBAR_4_12M: "قصائر 4–12 م",
  SCRAP: "خردة",
};

const gradeLabels: Record<string, string> = {
  FIRST: "نخب أول",
  SECOND: "نخب ثاني",
};

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  draft: { label: "مسودة", variant: "secondary" },
  approved: { label: "معتمد", variant: "default" },
  in_progress: { label: "قيد التنفيذ", variant: "default" },
  completed: { label: "مكتمل", variant: "secondary" },
  cancelled: { label: "ملغى", variant: "destructive" },
};

function formatKindDisplay(kind: string, grade: string | null): string {
  const k = kindLabels[kind] ?? kind;
  if (!grade) return k;
  const g = gradeLabels[grade] ?? grade;
  return `${k} (${g})`;
}

function formatQtyTons(value: string): string {
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return n.toLocaleString("ar-SA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

export function SalesOrderList() {
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
      toast.error("خطأ في جلب بيانات أوامر البيع");
    } finally {
      setLoading(false);
    }
  }, [search, page, statusFilter, kindFilter]);

  useEffect(() => {
    const timer = setTimeout(fetchOrders, 300);
    return () => clearTimeout(timer);
  }, [fetchOrders]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="بحث برقم الأمر أو اسم العميل..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pr-9"
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
            <SelectValue placeholder="الحالة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="draft">مسودة</SelectItem>
            <SelectItem value="approved">معتمد</SelectItem>
            <SelectItem value="in_progress">قيد التنفيذ</SelectItem>
            <SelectItem value="completed">مكتمل</SelectItem>
            <SelectItem value="cancelled">ملغى</SelectItem>
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
            <SelectValue placeholder="النوع" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأنواع</SelectItem>
            <SelectItem value="REBAR">مبروم</SelectItem>
            <SelectItem value="SHORTBAR_1_4M">قصائر 1–4 م</SelectItem>
            <SelectItem value="SHORTBAR_4_12M">قصائر 4–12 م</SelectItem>
            <SelectItem value="SCRAP">خردة</SelectItem>
          </SelectContent>
        </Select>
        {canCreateSalesOrder && (
          <Button onClick={() => router.push("/sales-orders/new")} size="sm">
            <Plus className="h-4 w-4" />
            أمر بيع جديد
          </Button>
        )}
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table className="min-w-[700px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">رقم الأمر</TableHead>
              <TableHead>العميل</TableHead>
              <TableHead className="min-w-[140px]">النوع</TableHead>
              <TableHead className="w-28">الكمية (طن)</TableHead>
              <TableHead className="w-28">الحالة</TableHead>
              <TableHead className="w-24 text-center">بنود الأسعار</TableHead>
              <TableHead className="w-36">تاريخ الإنشاء</TableHead>
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
                      ? "لا توجد نتائج"
                      : "لا توجد أوامر بيع — أنشئ أمرًا جديدًا"}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              orders.map((o) => {
                const st =
                  statusMap[o.status] ?? {
                    label: o.status,
                    variant: "secondary" as const,
                  };
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
                    <TableCell className="font-mono text-sm tabular-nums">
                      {formatQtyTons(o.totalQtyTons)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {o._count.items}
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(o.createdAt).toLocaleDateString("ar-SA")}
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
            <ChevronRight className="h-4 w-4" />
            السابق
          </Button>
          <span className="text-sm text-muted-foreground">
            صفحة {page} من {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            التالي
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
