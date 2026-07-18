import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/page-auth";
import { ProductionInForm } from "@/components/stock/production-in-form";

export default async function OpeningBalancePage() {
  await requirePagePermission("stock.opening_balance");
  const t = await getTranslations("stock");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("openingBalanceTitle")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("openingBalanceSubtitle")}
        </p>
      </div>
      <ProductionInForm mode="opening" />
    </div>
  );
}
