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
  SHORTBAR_1_4M: "توالف 1–4م",
  SHORTBAR_4_12M: "توالف 4–12م",
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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (paymentId == null) {
      setData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/payments/${paymentId}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setData(json.data);
        else toast.error("خطأ في جلب تفاصيل الدفعة");
      })
      .catch(() => toast.error("خطأ في الاتصال"))
      .finally(() => setLoading(false));
  }, [paymentId]);

  return (
    <Dialog open={paymentId != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>تفاصيل الدفعة #{paymentId}</DialogTitle>
        </DialogHeader>

        {loading || !data ? (
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
                  {data.customer.fullName}{" "}
                  <span className="text-xs text-muted-foreground">({data.customer.code})</span>
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">المبلغ</span>
                <p className="font-mono font-semibold">${formatAmount(data.amount)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">طريقة الدفع</span>
                <p>{methodLabels[data.method] ?? data.method}</p>
              </div>
              <div>
                <span className="text-muted-foreground">تاريخ الدفع</span>
                <p>{new Date(data.paymentDate).toLocaleDateString("ar-SA")}</p>
              </div>
              {data.referenceNumber && (
                <div>
                  <span className="text-muted-foreground">رقم المرجع</span>
                  <p>{data.referenceNumber}</p>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">بواسطة</span>
                <p>{data.creator.fullName}</p>
              </div>
            </div>

            {data.notes && (
              <div className="text-sm">
                <span className="text-muted-foreground">ملاحظات</span>
                <p className="mt-0.5">{data.notes}</p>
              </div>
            )}

            <div>
              <h4 className="text-sm font-semibold mb-2">
                التوزيعات على أوامر البيع ({data.allocations.length})
              </h4>
              {data.allocations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  لا توجد توزيعات — المبلغ كامل كرصيد غير مخصّص للعميل
                </p>
              ) : (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>رقم الأمر</TableHead>
                        <TableHead>النوع</TableHead>
                        <TableHead className="text-left">المبلغ المخصّص</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.allocations.map((a) => (
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
