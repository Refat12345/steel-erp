import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/page-auth";
import { StockOverview } from "@/components/stock/stock-overview";

export default async function StockPage() {
  await requirePagePermission("stock.view");
  const t = await getTranslations("stock");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>
      <StockOverview />
    </div>
  );
}
