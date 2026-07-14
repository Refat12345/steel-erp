import { requirePagePermission } from "@/lib/page-auth";
import { StockLocationManager } from "@/components/stock/stock-location-manager";

export default async function StockLocationsPage() {
  // Stricter than the /stock group (which only needs stock.view): editing the
  // yard layout requires the manage permission at Layer 2/3.
  await requirePagePermission("stock.location.manage");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">إعداد مواقع المخزون</h1>
        <p className="text-sm text-muted-foreground mt-1">
          مواقع الساحتين الأمامية والخلفية: الاسم قابل للتعديل، والكود يُثبَّت بعد
          أول حركة. الإيقاف بدل الحذف للمواقع التي عليها حركات.
        </p>
      </div>
      <StockLocationManager />
    </div>
  );
}
