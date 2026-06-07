import { requirePagePermission } from "@/lib/page-auth";
import { DailyLoadingSummaryView } from "@/components/reports/daily-loading-summary-report";

export default async function DailyLoadingSummaryPage() {
  await requirePagePermission("report.daily_trucks");
  return <DailyLoadingSummaryView />;
}
