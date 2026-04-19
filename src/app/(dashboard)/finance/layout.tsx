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
    return (
      <UnderDevelopment
        title="المالية"
        description="هذا القسم موقوف مؤقتاً وهو قيد التطوير."
      />
    );
  }

  return <>{children}</>;
}
