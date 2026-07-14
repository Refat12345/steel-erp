import { requirePagePermission } from "@/lib/page-auth";
import { StockAdjustForm } from "@/components/stock/stock-adjust-form";

export default async function StockAdjustPage() {
  await requirePagePermission("stock.adjust");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">تصحيح الجرد</h1>
        <p className="text-sm text-muted-foreground mt-1">
          مطابقة رصيد النظام مع العدّ الفعلي في الساحة. أدخل الكمية المعدودة
          فعلياً — يحسب النظام الفرق ويسجّله كحركة تصحيح موثّقة بسبب.
        </p>
      </div>
      <StockAdjustForm />
    </div>
  );
}
