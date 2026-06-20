import { requirePagePermission } from "@/lib/page-auth";
import { REPORTS_PERMISSION } from "@/lib/rbac-policy";
import { BilletBalanceReportView } from "@/components/reports/billet-balance-report";

export default async function BilletBalanceReportPage() {
  await requirePagePermission(REPORTS_PERMISSION);
  return <BilletBalanceReportView />;
}
