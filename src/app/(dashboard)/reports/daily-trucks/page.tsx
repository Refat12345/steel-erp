import { requirePagePermission } from "@/lib/page-auth";
import { DailyTrucksReportView } from "@/components/reports/daily-trucks-report";

export default async function DailyTrucksReportPage() {
  await requirePagePermission("report.daily_trucks");
  return <DailyTrucksReportView />;
}
