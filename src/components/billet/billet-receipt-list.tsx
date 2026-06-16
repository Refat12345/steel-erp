"use client";

import { useState, useEffect, useCallback } from "react";
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
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Plus, Search, Truck, ChevronLeft, ChevronRight } from "lucide-react";
import { RegisterBilletReceiptDialog } from "@/components/billet/register-billet-receipt-dialog";

interface ReceiptItem {
  id: number;
  receiptNumber: string;
  plateNumber: string;
  driverName: string;
  status: string;
  netWeightKg: string | null;
  createdAt: string;
  contract: { contractNumber: string; supplierName: string };
}

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  Registered: { label: "مسجّلة", variant: "outline" },
  Loaded: { label: "وُزنت محمّلة", variant: "secondary" },
  Unloading: { label: "قيد التفريغ", variant: "secondary" },
  AwaitingExit: { label: "بانتظار الخروج", variant: "secondary" },
  Completed: { label: "مكتملة", variant: "default" },
  Cancelled: { label: "ملغاة", variant: "destructive" },
};

function formatKg(value: string | null): string {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function BilletReceiptList() {
  const { data: session } = useSession();
  const canRegister = sessionHasPermission(session, "billet.receipt.register");
  const router = useRouter();
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [plateNumber, setPlateNumber] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const pageSize = 25;

  const fetchReceipts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (plateNumber) params.set("plateNumber", plateNumber);
      if (status) params.set("status", status);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/billet-receipts?${params}`);
      const json = await res.json();
      if (json.success) {
        setReceipts(json.data);
        setTotal(json.total);
      }
    } catch {
      toast.error("خطأ في جلب سجلات الاستلام");
    } finally {
      setLoading(false);
    }
  }, [plateNumber, status, page]);

  useEffect(() => {
    setPage(1);
  }, [plateNumber, status]);

  useEffect(() => {
    const timer = setTimeout(fetchReceipts, 300);
    return () => clearTimeout(timer);
  }, [fetchReceipts]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="بحث برقم اللوحة..."
            value={plateNumber}
            onChange={(e) => setPlateNumber(e.target.value)}
            className="pr-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v ?? "")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="كل الحالات" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">كل الحالات</SelectItem>
            <SelectItem value="Registered">مسجّلة</SelectItem>
            <SelectItem value="Loaded">وُزنت محمّلة</SelectItem>
            <SelectItem value="Unloading">قيد التفريغ</SelectItem>
            <SelectItem value="AwaitingExit">بانتظار الخروج</SelectItem>
            <SelectItem value="Completed">مكتملة</SelectItem>
            <SelectItem value="Cancelled">ملغاة</SelectItem>
          </SelectContent>
        </Select>
        {canRegister && (
          <Button onClick={() => setDialogOpen(true)} size="sm">
            <Plus className="h-4 w-4" />
            تسجيل استلام
          </Button>
        )}
      </div>

      <div className="rounded-lg border">
        <Table className="w-full min-w-[820px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-28 text-start">رقم الاستلام</TableHead>
              <TableHead className="w-40 max-w-40 text-start">المورّد</TableHead>
              <TableHead className="w-32 text-start">اللوحة</TableHead>
              <TableHead className="w-32 text-start">السائق</TableHead>
              <TableHead className="w-28 text-start">الصافي (كغ)</TableHead>
              <TableHead className="w-24 text-center">الحالة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : receipts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Truck className="h-8 w-8 opacity-40" />
                    {plateNumber || status ? "لا توجد نتائج" : "لا توجد سجلات استلام بعد"}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              receipts.map((r) => {
                const st = statusMap[r.status] || statusMap.Registered;
                return (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/billet-receipts/${r.id}`)}
                  >
                    <TableCell className="text-start font-mono text-sm font-semibold">
                      {r.receiptNumber}
                    </TableCell>
                    <TableCell className="max-w-40 text-start">
                      <span className="block truncate" title={r.contract.supplierName}>
                        {r.contract.supplierName}
                      </span>
                    </TableCell>
                    <TableCell className="text-start">{r.plateNumber}</TableCell>
                    <TableCell className="text-start truncate">{r.driverName}</TableCell>
                    <TableCell className="text-start tabular-nums">
                      {formatKg(r.netWeightKg)}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {total > pageSize && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            صفحة {page} من {totalPages} — {total} سجل
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <RegisterBilletReceiptDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={fetchReceipts}
      />
    </div>
  );
}
