"use client";

import { useTranslations } from "next-intl";
import { SalesOrderList } from "@/components/sales-orders/sales-order-list";

export default function SalesOrdersPage() {
  const t = useTranslations("salesOrders");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <SalesOrderList />
    </div>
  );
}
