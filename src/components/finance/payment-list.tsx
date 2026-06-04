"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Wallet,
  ChevronLeft,
  ChevronRight,
  Eye,
} from "lucide-react";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { PaymentDetailDialog } from "./payment-detail-dialog";
import { CustomerBalanceDialog } from "./customer-balance-dialog";
import { formatDate } from "@/lib/date-format";

interface PaymentRow {
  id: number;
  customerId: number;
  amount: string;
  method: string;
  paymentDate: string;
  referenceNumber: string | null;
  notes: string | null;
  createdAt: string;
  customer: { id: number; code: string; fullName: string };
  creator: { id: number; fullName: string };
  _count: { allocations: number };
}

const methodLabels: Record<string, string> = {
  CASH: "نقدي",
  BANK_TRANSFER: "تحويل بنكي",
  CHECK: "شيك",
};

const methodVariant: Record<string, "default" | "secondary"> = {
  CASH: "default",
  BANK_TRANSFER: "secondary",
  CHECK: "secondary",
};

function formatAmount(value: string): string {
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function PaymentList() {
  const { data: session } = useSession();
  const canCreate = sessionHasPermission(session, "payment.create");
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [balanceCustomerId, setBalanceCustomerId] = useState<number | null>(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total],
  );

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (methodFilter !== "all") params.set("method", methodFilter);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/payments?${params}`);
      const json = await res.json();
      if (json.success) {
        setPayments(json.data);
        setTotal(json.total);
      }
    } catch {
      toast.error("خطأ في جلب بيانات الدفعات");
    } finally {
      setLoading(false);
    }
  }, [methodFilter, page]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={methodFilter}
          onValueChange={(v) => {
            setMethodFilter(v ?? "all");
            setPage(1);
          }}
        >
          <SelectTrigger size="sm" className="min-w-[180px]">
            <SelectValue placeholder="طريقة الدفع" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الطرق</SelectItem>
            <SelectItem value="CASH">نقدي</SelectItem>
            <SelectItem value="BANK_TRANSFER">تحويل بنكي</SelectItem>
            <SelectItem value="CHECK">شيك</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1" />

        {canCreate && (
          <Button onClick={() => setShowCreate(true)} size="sm">
            <Plus className="h-4 w-4" />
            تسجيل دفعة
          </Button>
        )}
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table className="min-w-[700px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">#</TableHead>
              <TableHead>العميل</TableHead>
              <TableHead className="w-32">المبلغ ($)</TableHead>
              <TableHead className="w-32">طريقة الدفع</TableHead>
              <TableHead className="w-32">تاريخ الدفع</TableHead>
              <TableHead className="w-24 text-center">توزيعات</TableHead>
              <TableHead className="w-36">المرجع</TableHead>
              <TableHead className="w-36">بواسطة</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : payments.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="h-32 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <Wallet className="h-8 w-8 opacity-40" />
                    لا توجد دفعات مسجّلة
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.id}</TableCell>
                  <TableCell>
                    <button
                      className="font-medium text-primary hover:underline text-start"
                      onClick={() => setBalanceCustomerId(p.customer.id)}
                    >
                      {p.customer.fullName}
                    </button>
                    <span className="block text-xs text-muted-foreground">
                      {p.customer.code}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono font-semibold tabular-nums">
                    {formatAmount(p.amount)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={methodVariant[p.method] ?? "secondary"}>
                      {methodLabels[p.method] ?? p.method}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatDate(p.paymentDate)}
                  </TableCell>
                  <TableCell className="text-center text-sm">
                    {p._count.allocations}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground truncate max-w-[140px]">
                    {p.referenceNumber || "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.creator.fullName}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDetailId(p.id)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
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

      <RecordPaymentDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onSuccess={fetchPayments}
      />

      <PaymentDetailDialog
        paymentId={detailId}
        onClose={() => setDetailId(null)}
      />

      <CustomerBalanceDialog
        customerId={balanceCustomerId}
        onClose={() => setBalanceCustomerId(null)}
      />
    </div>
  );
}
