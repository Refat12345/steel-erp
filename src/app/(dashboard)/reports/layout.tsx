import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/page-auth";
import {
  isAnalyticsRestrictedRole,
  REPORTS_PERMISSION,
} from "@/lib/rbac-policy";
import { logger } from "@/lib/logger";

export default async function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // High-level gate for the entire /reports section. Individual report
  // pages add their own per-report permission check on top of this.
  const session = await requirePagePermission(REPORTS_PERMISSION);

  // Hardcoded denylist — not bypassable via permission overrides.
  if (isAnalyticsRestrictedRole(session.role)) {
    logger.warn(
      {
        userId: session.userId,
        username: session.username,
        roleCode: session.role,
      },
      "reports page access denied — role on ANALYTICS_RESTRICTED_ROLES",
    );
    redirect("/forbidden");
  }

  return <>{children}</>;
}
