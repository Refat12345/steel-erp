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
import { formatAmount } from "@/lib/number-format";
import { getTextDirection, type Locale } from "@/i18n/config";

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

interface Props {
  customerId: number | null;
  onClose: () => void;
}

export function CustomerBalanceDialog({ customerId, onClose }: Props) {
  const t = useTranslations("finance");
  const tEnums = useTranslations("enums");
  const locale = useLocale() as Locale;
  const dir = getTextDirection(locale);
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
        else toast.error(t("errorLoadBalance"));
      })
      .catch(() => {
        if (!cancelled) toast.error(t("errorConnectionShort"));
      });

    return () => {
      cancelled = true;
    };
  }, [customerId, t]);

  function kindLabel(kind: string): string {
    const key = `materialKind.${kind}` as const;
    return tEnums.has(key) ? tEnums(key) : kind;
  }

  function statusLabel(status: string): string {
    const key = `salesOrderStatus.${status}` as const;
    return tEnums.has(key) ? tEnums(key) : status;
  }

  return (
    <Dialog open={customerId != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir={dir} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {currentData
              ? t("balanceTitleNamed", { name: currentData.customerName })
              : t("balanceTitle")}
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">{t("totalPaid")}</p>
                  <p className="font-mono text-lg font-bold financial-value">
                    ${formatAmount(currentData.totalPaid)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">{t("totalAllocated")}</p>
                  <p className="font-mono text-lg font-bold financial-value">
                    ${formatAmount(currentData.totalAllocated)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">{t("unallocatedCredit")}</p>
                  <p className="font-mono text-lg font-bold text-primary financial-value">
                    ${formatAmount(currentData.unallocatedCredit)}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">
                {t("salesOrdersTitle", { count: currentData.orderBalances.length })}
              </h4>
              {currentData.orderBalances.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noSalesOrders")}</p>
              ) : (
                <div className="rounded-lg border overflow-x-auto">
                  <Table className="min-w-[500px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("colOrderNumber")}</TableHead>
                        <TableHead>{t("colKind")}</TableHead>
                        <TableHead>{t("colStatus")}</TableHead>
                        <TableHead className="text-start">{t("colAllocatedPayments")}</TableHead>
                        <TableHead className="text-start">{t("colLoadedValue")}</TableHead>
                        <TableHead className="text-start">{t("colBalance")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentData.orderBalances.map((ob) => (
                        <TableRow key={ob.orderNumber}>
                          <TableCell className="font-mono text-sm">
                            {ob.orderNumber}
                          </TableCell>
                          <TableCell className="text-sm">
                            {kindLabel(ob.kind)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-xs">
                              {statusLabel(ob.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm financial-value">
                            ${formatAmount(ob.totalAllocated)}
                          </TableCell>
                          <TableCell className="font-mono text-sm financial-value">
                            ${formatAmount(ob.loadedValue)}
                          </TableCell>
                          <TableCell className="font-mono text-sm financial-value">
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
