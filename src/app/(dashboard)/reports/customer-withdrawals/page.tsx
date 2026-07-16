import { requirePagePermission } from "@/lib/page-auth";
import { getAnalyticsStartDateValue } from "@/lib/services/settings.service";
import { CustomerWithdrawalsReportView } from "@/components/reports/customer-withdrawals-report";

export default async function CustomerWithdrawalsReportPage() {
  await requirePagePermission("report.daily_trucks");
  // This report does NOT auto-load on mount (the user picks a range first),
  // so the date pickers' lower bound can't come from the report payload —
  // resolve it server-side and pass it down.
  const analyticsStartDate = await getAnalyticsStartDateValue();
  return <CustomerWithdrawalsReportView analyticsStartDate={analyticsStartDate} />;
}
