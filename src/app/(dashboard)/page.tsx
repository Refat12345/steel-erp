import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Factory, CalendarDays, LayoutDashboard } from "lucide-react";
import { ChartsSection } from "@/components/dashboard/charts-section.operations";
import { resolveUserAuth } from "@/lib/permissions";
import {
  canAccessDashboard,
  getRoleLandingPage,
  isAnalyticsRestrictedRole,
} from "@/lib/rbac-policy";
import { logger } from "@/lib/logger";
import { BRAND } from "@/lib/brand";
import { formatDate } from "@/lib/date-format";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login");
  }

  const userId = session.user.id as number | undefined;
  if (typeof userId !== "number") {
    redirect("/login");
  }

  // Authoritative, DB-backed auth context — role + permissions re-read
  // from the database so that JWT tampering, stale JWTs, and admin
  // overrides granted post-login cannot bypass this gate.
  const auth = await resolveUserAuth(userId);
  if (!auth) {
    redirect("/login");
  }

  if (!canAccessDashboard({ roleCode: auth.roleCode, permissions: auth.permissions })) {
    logger.warn(
      {
        userId: auth.userId,
        username: auth.username,
        roleCode: auth.roleCode,
        reason: isAnalyticsRestrictedRole(auth.roleCode)
          ? "role is on ANALYTICS_RESTRICTED_ROLES denylist"
          : "missing dashboard.view permission",
      },
      "dashboard page access denied",
    );
    // Prefer the role's configured landing page (e.g. shop-floor
    // roles land on /trucks) so login never ends on a dead-end
    // /forbidden screen. Fall back to /forbidden only when there is
    // no mapped home for the role.
    redirect(getRoleLandingPage(auth.roleCode) ?? "/forbidden");
  }

  const dateStr = formatDate(new Date());

  return (
    <div className="space-y-8">

      {/* ── Greeting Banner ─────────────────────────────────────────── */}
      <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
            style={{
              background: "oklch(0.390 0.130 232 / 12%)",
              boxShadow: "inset 0 0 0 1px oklch(0.390 0.130 232 / 22%)",
            }}
          >
            <Factory
              className="h-6 w-6"
              style={{ color: "oklch(0.390 0.130 232)" }}
            />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">
              أهلاً،{" "}
              <span style={{ color: "oklch(0.390 0.130 232)" }}>
                {session?.user.name}
              </span>
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {BRAND.welcomeAr}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold"
            style={{
              background: "oklch(0.390 0.130 232 / 10%)",
              color: "oklch(0.390 0.130 232)",
              boxShadow: "inset 0 0 0 1px oklch(0.390 0.130 232 / 22%)",
            }}
          >
            {session?.user.roleName}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            {dateStr}
          </span>
        </div>
      </div>

      {/* ── Section Label ────────────────────────────────────────────── */}
      <div className="animate-in fade-in-0 duration-500 delay-75 flex items-center gap-3">
        <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          لوحة المؤشرات
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* ── Charts + KPIs (client component) ────────────────────────── */}
      <ChartsSection />

    </div>
  );
}
