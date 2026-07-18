import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/page-auth";
import { BilletContractList } from "@/components/billet/billet-contract-list";

export default async function BilletContractsPage() {
  await requirePagePermission("billet.contract.view");
  const t = await getTranslations("billet");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("contracts.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("contracts.subtitle")}</p>
      </div>
      <BilletContractList />
    </div>
  );
}
