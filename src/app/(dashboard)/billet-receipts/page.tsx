import { getTranslations } from "next-intl/server";
import { requirePagePermission } from "@/lib/page-auth";
import { BilletReceiptList } from "@/components/billet/billet-receipt-list";

export default async function BilletReceiptsPage() {
  await requirePagePermission("billet.receipt.view");
  const t = await getTranslations("billet");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("receipts.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("receipts.subtitle")}</p>
      </div>
      <BilletReceiptList />
    </div>
  );
}
