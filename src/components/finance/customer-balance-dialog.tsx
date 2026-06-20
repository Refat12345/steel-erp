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
import { Card, CardContent } from "@/components/ui/card";

interface OrderBalance {
  orderNumber: string;
  kind: string;
  grade: string | null;
  status: string;
  totalAllocated: string;
  loadedValue: string;
  balance: string;
}

interface BalanceData {
  customerId: number;
  customerCode: string;
  customerName: string;
  totalPaid: string;
  totalAllocated: string;
  unallocatedCredit: string;
  orderBalances: OrderBalance[];
}

const kindLabels: Record<string, string> = {
  REBAR: "مبروم",
  SHORTBAR_1_4M: "قصائر 1–4 م",
  SHORTBAR_4_12M: "قصائر 4–12 م",
  SCRAP: "خردة",
  BILLET_WIRE: "أسلاك تربيط",
};

const statusLabels: Record<string, string> = {
  draft: "مسودة",
  approved: "معتمد",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  cancelled: "ملغى",
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
  customerId: number | null;
  onClose: () => void;
}

export function CustomerBalanceDialog({ customerId, onClose }: Props) {
  const [data, setData] = useState<BalanceData | null>(null);
  const currentData = data?.customerId === customerId ? data : null;

  useEffect(() => {
    if (customerId == null) return;

    let cancelled = false;
    fetch(`/api/customers/${customerId}/balance`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) setData(json.data);
        else toast.error("خطأ في جلب الرصيد");
      })
      .catch(() => {
        if (!cancelled) toast.error("خطأ في الاتصال");
      });

    return () => {
      cancelled = true;
    };
  }, [customerId]);

  return (
    <Dialog open={customerId != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            رصيد العميل {currentData ? `— ${currentData.customerName}` : ""}
          </DialogTitle>
        </DialogHeader>

        {!currentData ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">إجمالي المدفوع</p>
                  <p className="font-mono text-lg font-bold">${formatAmount(currentData.totalPaid)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">إجمالي الموزّع</p>
                  <p className="font-mono text-lg font-bold">${formatAmount(currentData.totalAllocated)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">رصيد غير مخصّص</p>
                  <p className="font-mono text-lg font-bold text-primary">
                    ${formatAmount(currentData.unallocatedCredit)}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">
                أوامر البيع ({currentData.orderBalances.length})
              </h4>
              {currentData.orderBalances.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد أوامر بيع</p>
              ) : (
                <div className="rounded-lg border overflow-x-auto">
                  <Table className="min-w-[500px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>رقم الأمر</TableHead>
                        <TableHead>النوع</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead className="text-left">مدفوعات مخصّصة</TableHead>
                        <TableHead className="text-left">قيمة التحميل</TableHead>
                        <TableHead className="text-left">الرصيد</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentData.orderBalances.map((ob) => (
                        <TableRow key={ob.orderNumber}>
                          <TableCell className="font-mono text-sm">
                            {ob.orderNumber}
                          </TableCell>
                          <TableCell className="text-sm">
                            {kindLabels[ob.kind] ?? ob.kind}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-xs">
                              {statusLabels[ob.status] ?? ob.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            ${formatAmount(ob.totalAllocated)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            ${formatAmount(ob.loadedValue)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            ${formatAmount(ob.balance)}
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
