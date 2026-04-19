import { UnderDevelopment } from "@/components/under-development";
import { SUSPEND_SALES_ORDERS_UI } from "@/config/suspended-pages";
import { requirePagePermission } from "@/lib/page-auth";

export default async function SalesOrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("salesorder.view");

  if (SUSPEND_SALES_ORDERS_UI) {
    return (
      <UnderDevelopment
        title="أوامر البيع"
        description="هذا القسم موقوف مؤقتاً وهو قيد التطوير."
      />
    );
  }

  return <>{children}</>;
}
