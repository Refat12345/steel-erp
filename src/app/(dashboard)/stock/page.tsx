import { requirePagePermission } from "@/lib/page-auth";
import { StockOverview } from "@/components/stock/stock-overview";

export default async function StockPage() {
  await requirePagePermission("stock.view");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">المخزون</h1>
        <p className="text-sm text-muted-foreground mt-1">
          نظرة عامة على الساحات والأرصدة الحيّة موزّعة على الخريطة، مع ملخصات حسب
          النخب والمقاس.
        </p>
      </div>
      <StockOverview />
    </div>
  );
}
