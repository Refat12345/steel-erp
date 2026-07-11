import { requirePagePermission } from "@/lib/page-auth";
import { CustomerWithdrawalsReportView } from "@/components/reports/customer-withdrawals-report";

export default async function CustomerWithdrawalsReportPage() {
  await requirePagePermission("report.daily_trucks");
  return <CustomerWithdrawalsReportView />;
}
