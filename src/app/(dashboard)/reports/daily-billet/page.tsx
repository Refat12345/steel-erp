import { requirePagePermission } from "@/lib/page-auth";
import { REPORTS_PERMISSION } from "@/lib/rbac-policy";
import { DailyBilletReportView } from "@/components/reports/daily-billet-report";

export default async function DailyBilletReportPage() {
  await requirePagePermission(REPORTS_PERMISSION);
  return <DailyBilletReportView />;
}
