"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/date-format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface Allocation {
  id: number;
  allocatedAmount: string;
  salesOrder: {
    orderNumber: string;
    kind: string;
    grade: string | null;
    status: string;
  };
}

interface PaymentDetailData {
  id: number;
  amount: string;
  method: string;
  paymentDate: string;
  referenceNumber: string | null;
  notes: string | null;
  createdAt: string;
  customer: { id: number; code: string; fullName: string };
  creator: { id: number; fullName: string };
  allocations: Allocation[];
}

const methodLabels: Record<string, string> = {
  CASH: "نقدي",
  BANK_TRANSFER: "تحويل بنكي",
  CHECK: "شيك",
};

const kindLabels: Record<string, string> = {
  REBAR: "مبروم",
  SHORTBAR_1_4M: "قصائر 1–4 م",
  SHORTBAR_4_12M: "قصائر 4–12 م",
  SCRAP: "خردة",
};

function formatAmount(value: string): string {
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface Props {
  paymentId: number | null;
  onClose: () => void;
}

export function PaymentDetailDialog({ paymentId, onClose }: Props) {
  const [data, setData] = useState<PaymentDetailData | null>(null);
  const currentData = data?.id === paymentId ? data : null;

  useEffect(() => {
    if (paymentId == null) return;

    let cancelled = false;
    fetch(`/api/payments/${paymentId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) setData(json.data);
        else toast.error("خطأ في جلب تفاصيل الدفعة");
      })
      .catch(() => {
        if (!cancelled) toast.error("خطأ في الاتصال");
      });

    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  return (
    <Dialog open={paymentId != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>تفاصيل الدفعة #{paymentId}</DialogTitle>
        </DialogHeader>

        {!currentData ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">العميل</span>
                <p className="font-medium">
                  {currentData.customer.fullName}{" "}
                  <span className="text-xs text-muted-foreground">({currentData.customer.code})</span>
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">المبلغ</span>
                <p className="font-mono font-semibold">${formatAmount(currentData.amount)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">طريقة الدفع</span>
                <p>{methodLabels[currentData.method] ?? currentData.method}</p>
              </div>
              <div>
                <span className="text-muted-foreground">تاريخ الدفع</span>
                <p>{formatDate(currentData.paymentDate)}</p>
              </div>
              {currentData.referenceNumber && (
                <div>
                  <span className="text-muted-foreground">رقم المرجع</span>
                  <p>{currentData.referenceNumber}</p>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">بواسطة</span>
                <p>{currentData.creator.fullName}</p>
              </div>
            </div>

            {currentData.notes && (
              <div className="text-sm">
                <span className="text-muted-foreground">ملاحظات</span>
                <p className="mt-0.5">{currentData.notes}</p>
              </div>
            )}

            <div>
              <h4 className="text-sm font-semibold mb-2">
                التوزيعات على أوامر البيع ({currentData.allocations.length})
              </h4>
              {currentData.allocations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  لا توجد توزيعات — المبلغ كامل كرصيد غير مخصّص للعميل
                </p>
              ) : (
                <div className="rounded-lg border overflow-x-auto">
                  <Table className="min-w-[500px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>رقم الأمر</TableHead>
                        <TableHead>النوع</TableHead>
                        <TableHead className="text-left">المبلغ المخصّص</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentData.allocations.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-mono text-sm">
                            {a.salesOrder.orderNumber}
                          </TableCell>
                          <TableCell className="text-sm">
                            {kindLabels[a.salesOrder.kind] ?? a.salesOrder.kind}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            ${formatAmount(a.allocatedAmount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
