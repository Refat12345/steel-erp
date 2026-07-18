import { getTranslations } from "next-intl/server";
import { UnderDevelopment } from "@/components/under-development";
import { SUSPEND_FINANCE_UI } from "@/config/suspended-pages";
import { requirePagePermission } from "@/lib/page-auth";

export default async function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("payment.view");

  if (SUSPEND_FINANCE_UI) {
    const t = await getTranslations("finance");
    return (
      <UnderDevelopment
        title={t("title")}
        description={t("suspendedDescription")}
      />
    );
  }

  return <>{children}</>;
}
