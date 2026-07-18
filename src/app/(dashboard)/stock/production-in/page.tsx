import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/page-auth";
import { ProductionInForm } from "@/components/stock/production-in-form";
import type { StockUnit } from "@/components/stock/stock-shared";

export default async function ProductionInPage() {
  // Either production permission may open the page; the form only offers the
  // counting units the user is actually allowed to enter.
  const session = await requirePagePermission(
    "stock.production.ton",
    "stock.production.bundle",
  );
  const allowedUnits: StockUnit[] = [];
  if (session.permissions.has("stock.production.bundle")) allowedUnits.push("BUNDLE");
  if (session.permissions.has("stock.production.ton")) allowedUnits.push("TON");
  const t = await getTranslations("stock");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("productionInTitle")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("productionInSubtitle")}</p>
      </div>
      <ProductionInForm allowedUnits={allowedUnits} />
    </div>
  );
}
