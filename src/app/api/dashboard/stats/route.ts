import { NextResponse } from "next/server";
import { forbidden, getApiSession, unauthorized } from "@/lib/api-utils";
import { getDashboardStatsCached } from "@/lib/dashboard-stats";
import {
  canAccessDashboard,
  isAnalyticsRestrictedRole,
} from "@/lib/rbac-policy";
import { logger } from "@/lib/logger";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();

  // Layer-3 gate: hardcoded role denylist + `dashboard.view` permission.
  // Both conditions come from the DB-resolved session (not the JWT),
  // so this is not bypassable by stale tokens or manual override grants
  // against a restricted role.
  const permSet = new Set(session.permissions);
  if (!canAccessDashboard({ roleCode: session.role, permissions: permSet })) {
    logger.warn(
      {
        userId: session.userId,
        username: session.username,
        roleCode: session.role,
        reason: isAnalyticsRestrictedRole(session.role)
          ? "role is on ANALYTICS_RESTRICTED_ROLES denylist"
          : "missing dashboard.view permission",
      },
      "dashboard stats API access denied",
    );
    return forbidden();
  }

  try {
    const data = await getDashboardStatsCached();
    return NextResponse.json({ success: true, data });
  } catch (err) {
    logger.error({ err }, "dashboard stats error");
    return NextResponse.json(
      { success: false, error: "خطأ في جلب الإحصاءات" },
      { status: 500 },
    );
  }
}
