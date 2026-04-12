"use client";

import { SalesOrderList } from "@/components/sales-orders/sales-order-list";

export default function SalesOrdersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">أوامر البيع</h1>
        <p className="text-sm text-muted-foreground mt-1">
          إنشاء وإدارة أوامر البيع بأنماط التسوية المختلفة
        </p>
      </div>

      <SalesOrderList />
    </div>
  );
}
