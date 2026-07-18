import { UnderDevelopment } from "@/components/under-development";
import { SUSPEND_SALES_ORDERS_UI } from "@/config/suspended-pages";
import { requirePagePermission } from "@/lib/page-auth";
import { getTranslations } from "next-intl/server";

export default async function SalesOrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("salesorder.view");

  if (SUSPEND_SALES_ORDERS_UI) {
    const t = await getTranslations("salesOrders");
    return (
      <UnderDevelopment
        title={t("title")}
        description={t("suspendedDescription")}
      />
    );
  }

  return <>{children}</>;
}
