import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/page-auth";
import { StockAdjustForm } from "@/components/stock/stock-adjust-form";

export default async function StockAdjustPage() {
  await requirePagePermission("stock.adjust");
  const t = await getTranslations("stock");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("adjustTitle")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("adjustSubtitle")}</p>
      </div>
      <StockAdjustForm />
    </div>
  );
}
