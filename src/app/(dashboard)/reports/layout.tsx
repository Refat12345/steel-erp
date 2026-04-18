import { requirePagePermission } from "@/lib/page-auth";

export default async function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission(
    "report.daily_trucks",
    "report.customer_balance",
    "report.salesorder_status",
    "report.audit",
  );
  return <>{children}</>;
}
