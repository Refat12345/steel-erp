import { requirePagePermission } from "@/lib/page-auth";
import { ProductionInForm } from "@/components/stock/production-in-form";

export default async function OpeningBalancePage() {
  await requirePagePermission("stock.opening_balance");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">الرصيد الافتتاحي</h1>
        <p className="text-sm text-muted-foreground mt-1">
          إدخال جرد الساحة الفعلي يوم التفعيل كأرصدة افتتاحية. يُسجَّل كحركة رصيد
          افتتاحي لكل موقع/مقاس.
        </p>
      </div>
      <ProductionInForm mode="opening" />
    </div>
  );
}
