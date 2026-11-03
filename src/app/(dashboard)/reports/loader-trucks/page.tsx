import { requirePagePermission } from "@/lib/page-auth";
import { getAnalyticsStartDateValue } from "@/lib/services/settings.service";
import { LoaderTrucksReportView } from "@/components/reports/loader-trucks-report";

export default async function LoaderTrucksReportPage() {
  await requirePagePermission("report.loader_trucks");
  const analyticsStartDate = await getAnalyticsStartDateValue();
  return <LoaderTrucksReportView analyticsStartDate={analyticsStartDate} />;
}
