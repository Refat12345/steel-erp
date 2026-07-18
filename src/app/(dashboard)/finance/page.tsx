import { getTranslations } from "next-intl/server";
import { Wallet } from "lucide-react";
import { PaymentList } from "@/components/finance/payment-list";

export default async function FinancePage() {
  const t = await getTranslations("finance");

  return (
    <div className="flex-1 min-w-0 max-w-full p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "oklch(0.580 0.200 280 / 12%)",
            boxShadow: "inset 0 0 0 1px oklch(0.580 0.200 280 / 25%)",
          }}
        >
          <Wallet className="h-5 w-5" style={{ color: "oklch(0.580 0.200 280)" }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
      </div>

      <PaymentList />
    </div>
  );
}
