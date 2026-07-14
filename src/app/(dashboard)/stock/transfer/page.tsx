import { requirePagePermission } from "@/lib/page-auth";
import { StockTransferForm } from "@/components/stock/stock-transfer-form";

export default async function StockTransferPage() {
  await requirePagePermission("stock.transfer");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">ترحيل المخزون</h1>
        <p className="text-sm text-muted-foreground mt-1">
          نقل الرصيد من موقع إلى آخر. تظهر المواقع المقترحة (الفارغة أو التي تحمل
          نفس المقاس) أولاً.
        </p>
      </div>
      <StockTransferForm />
    </div>
  );
}
