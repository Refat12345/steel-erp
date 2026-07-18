import { NextResponse, type NextRequest } from "next/server";
import { forbidden, getApiSession, unauthorized } from "@/lib/api-utils";
import {
  canAccessDashboard,
  isAnalyticsRestrictedRole,
} from "@/lib/rbac-policy";
import {
  getOpsStatsCached,
  getOwnerStatsCached,
  type DashboardPeriod,
  type OpsStats,
} from "@/lib/services/operations-stats.service";
import { logger } from "@/lib/logger";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import { translateError } from "@/lib/i18n/server-messages";

const OPS_PERMISSION = "dashboard.ops.view";

function parsePeriod(value: string | null): DashboardPeriod {
  if (value === "week" || value === "month") return value;
  return "today";
}

export async function GET(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();

  // Base dashboard gate — denylisted roles and missing `dashboard.view`
  // are rejected here. Identical to the legacy /api/dashboard/stats gate
  // so the Owner role (`manager`) and finance roles continue to pass.
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
      "operations dashboard API access denied",
    );
    return forbidden();
  }

  const period = parsePeriod(
    req.nextUrl.searchParams.get("period"),
  );
  const includeOps = permSet.has(OPS_PERMISSION);

  try {
    // Only run the OPS aggregate when the caller is allowed to see it —
    // Owner-tier callers never pay the latency cost for data they will
    // not receive, and the sensitive fields are absent from the payload
    // (no client-side hiding only).
    const [owner, ops] = await Promise.all([
      getOwnerStatsCached(period),
      includeOps
        ? getOpsStatsCached()
        : (Promise.resolve(null) as Promise<OpsStats | null>),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        owner,
        ops, // null for Owner-tier callers
      },
    });
  } catch (err) {
    logger.error({ err }, "operations dashboard stats error");
    const locale = await getRequestLocale();
    return NextResponse.json(
      { success: false, error: translateError(locale, "statsFetchFailed") },
      { status: 500 },
    );
  }
}
