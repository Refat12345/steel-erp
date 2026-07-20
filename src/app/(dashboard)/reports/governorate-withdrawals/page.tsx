import { requirePagePermission } from "@/lib/page-auth";
import { getAnalyticsStartDateValue } from "@/lib/services/settings.service";
import { GovernorateWithdrawalsReportView } from "@/components/reports/governorate-withdrawals-report";

export default async function GovernorateWithdrawalsReportPage() {
  await requirePagePermission("report.daily_trucks");
  const analyticsStartDate = await getAnalyticsStartDateValue();
  return (
    <GovernorateWithdrawalsReportView analyticsStartDate={analyticsStartDate} />
  );
}
