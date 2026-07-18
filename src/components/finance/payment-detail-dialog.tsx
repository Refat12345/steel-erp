"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/date-format";
import { formatAmount } from "@/lib/number-format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { getTextDirection, type Locale } from "@/i18n/config";

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

interface Props {
  paymentId: number | null;
  onClose: () => void;
}

export function PaymentDetailDialog({ paymentId, onClose }: Props) {
  const t = useTranslations("finance");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
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
        else toast.error(t("errorLoadDetail"));
      })
      .catch(() => {
        if (!cancelled) toast.error(t("errorConnectionShort"));
      });

    return () => {
      cancelled = true;
    };
  }, [paymentId, t]);

  function methodLabel(method: string): string {
    const key = `paymentMethod.${method}` as const;
    return tEnums.has(key) ? tEnums(key) : method;
  }

  function kindLabel(kind: string): string {
    const key = `materialKind.${kind}` as const;
    return tEnums.has(key) ? tEnums(key) : kind;
  }

  return (
    <Dialog open={paymentId != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir={dir} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("detailTitle", { id: paymentId ?? "" })}</DialogTitle>
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
                <span className="text-muted-foreground">{t("customer")}</span>
                <p className="font-medium">
                  {currentData.customer.fullName}{" "}
                  <span className="text-xs text-muted-foreground">({currentData.customer.code})</span>
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("amountLabel")}</span>
                <p className="font-mono font-semibold financial-value">
                  ${formatAmount(currentData.amount)}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("paymentMethod")}</span>
                <p>{methodLabel(currentData.method)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("paymentDate")}</span>
                <p className="tabular-nums">{formatDate(currentData.paymentDate)}</p>
              </div>
              {currentData.referenceNumber && (
                <div>
                  <span className="text-muted-foreground">{t("referenceNumber")}</span>
                  <p>{currentData.referenceNumber}</p>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">{t("by")}</span>
                <p>{currentData.creator.fullName}</p>
              </div>
            </div>

            {currentData.notes && (
              <div className="text-sm">
                <span className="text-muted-foreground">{t("notes")}</span>
                <p className="mt-0.5">{currentData.notes}</p>
              </div>
            )}

            <div>
              <h4 className="text-sm font-semibold mb-2">
                {t("allocationsTitle", { count: currentData.allocations.length })}
              </h4>
              {currentData.allocations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("noAllocations")}
                </p>
              ) : (
                <div className="rounded-lg border overflow-x-auto">
                  <Table className="min-w-[500px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("colOrderNumber")}</TableHead>
                        <TableHead>{t("colKind")}</TableHead>
                        <TableHead className="text-start">{t("colAllocatedAmount")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentData.allocations.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-mono text-sm">
                            {a.salesOrder.orderNumber}
                          </TableCell>
                          <TableCell className="text-sm">
                            {kindLabel(a.salesOrder.kind)}
                          </TableCell>
                          <TableCell className="font-mono text-sm financial-value">
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
