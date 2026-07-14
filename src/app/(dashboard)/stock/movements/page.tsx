import { requirePagePermission } from "@/lib/page-auth";
import { StockMovementsView } from "@/components/stock/stock-movements-view";

export default async function StockMovementsPage() {
  // Stricter than the /stock layout (stock.view): the ledger is an add-on
  // permission so shop-floor roles can see the map without the full history.
  await requirePagePermission("stock.movements.view");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">المخزون: الأرصدة والحركات</h1>
        <p className="text-sm text-muted-foreground mt-1">
          الأرصدة الحالية محسوبة من الحركات، وسجل كامل بكل دخول/خروج/ترحيل.
        </p>
      </div>
      <StockMovementsView />
    </div>
  );
}
