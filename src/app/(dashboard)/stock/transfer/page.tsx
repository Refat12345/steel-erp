import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/page-auth";
import { StockTransferForm } from "@/components/stock/stock-transfer-form";

export default async function StockTransferPage() {
  await requirePagePermission("stock.transfer");
  const t = await getTranslations("stock");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("transferTitle")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("transferSubtitle")}</p>
      </div>
      <StockTransferForm />
    </div>
  );
}
