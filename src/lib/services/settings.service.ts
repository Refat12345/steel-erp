/**
 * ─── System Settings Service ──────────────────────────────────────────
 *
 * Reads and writes admin-tunable operational settings stored in the
 * `system_settings` key-value table.
 *
 * Currently owns one key:
 *
 *   `analytics_start_date` (YYYY-MM-DD, operational date)
 *      The date from which operational data is considered valid. Events
 *      before this date's 08:00 cutoff are invisible in the dashboard,
 *      event lists (trucks, payments, stock movements, billet receipts)
 *      and reports — enforced in the service layer via `clampEventWindow`.
 *      Cumulative entities (contracts, customer balances, billet contract
 *      balances) and the audit log are intentionally NOT filtered, and
 *      the underlying rows remain untouched in the database.
 *
 * Reads are cached for 60 s and tagged so a successful write invalidates
 * the cache immediately (`revalidateTag`) — the admin sees the effect on
 * the next dashboard refresh, not a minute later.
 * ─────────────────────────────────────────────────────────────────────
 */

import { revalidateTag, unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/services/audit.service";
import { ServiceError } from "@/lib/services/errors";
import {
  getOperationalDayWindow,
  parseOperationalDateInput,
} from "@/lib/operational-day";

export const ANALYTICS_START_DATE_KEY = "analytics_start_date";

const SETTINGS_CACHE_TAG = "system-settings";
/** Dashboard stat caches carry this tag so a settings write flushes them. */
export const DASHBOARD_STATS_CACHE_TAG = "dashboard-stats";

const SETTINGS_CACHE_TTL_SECONDS = 60;

async function readAnalyticsStartDateRaw(): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: ANALYTICS_START_DATE_KEY },
    select: { value: true },
  });
  return row?.value ?? null;
}

/** Raw YYYY-MM-DD value (or null when unset), cached. */
export async function getAnalyticsStartDateValue(): Promise<string | null> {
  return unstable_cache(
    readAnalyticsStartDateRaw,
    ["system-setting", ANALYTICS_START_DATE_KEY],
    { revalidate: SETTINGS_CACHE_TTL_SECONDS, tags: [SETTINGS_CACHE_TAG] },
  )();
}

/**
 * The analytics start as a concrete instant: the 08:00 operational
 * cutoff of the configured date. Null when unset or malformed (a
 * malformed stored value must degrade to "no filter", never crash the
 * dashboard).
 */
export async function getAnalyticsStartInstant(): Promise<Date | null> {
  const value = await getAnalyticsStartDateValue();
  if (!value) return null;
  try {
    return getOperationalDayWindow(value).from;
  } catch {
    return null;
  }
}

export interface EventWindowClamp {
  /** Effective lower bound: requested `from` raised to the analytics start. */
  from?: Date;
  /** Upper bound, passed through unchanged. */
  to?: Date;
  /** True when an explicitly-requested `from` was raised — i.e. the user
   *  asked for a range that reaches into the excluded era. Callers use
   *  this to surface a "range narrowed" notice. A floor applied to an
   *  unbounded query is normal operation, not a clamp worth announcing. */
  clamped: boolean;
  analyticsStartDate: string | null;
}

/**
 * Clamp an event-query window to the analytics start date. This is the
 * single security floor for every event list / report in the system:
 * services call it right before building their Prisma date filter, so
 * no route, query-param combination, or missing UI filter can reach
 * data from before the configured start.
 *
 * Long-lived ENTITIES (customers, contracts, destinations) must NOT go
 * through this — only time-stamped events do.
 */
export async function clampEventWindow(
  from?: Date,
  to?: Date,
): Promise<EventWindowClamp> {
  const value = await getAnalyticsStartDateValue();
  if (!value) return { from, to, clamped: false, analyticsStartDate: null };

  let start: Date;
  try {
    start = getOperationalDayWindow(value).from;
  } catch {
    // Malformed stored value degrades to "no filter" — never crash reads.
    return { from, to, clamped: false, analyticsStartDate: null };
  }

  if (from === undefined) {
    return { from: start, to, clamped: false, analyticsStartDate: value };
  }
  if (from < start) {
    return { from: start, to, clamped: true, analyticsStartDate: value };
  }
  return { from, to, clamped: false, analyticsStartDate: value };
}

/**
 * Set (or clear, with null) the analytics start date. Validates the
 * format, writes inside a transaction with an audit entry, and flushes
 * the settings + dashboard caches.
 */
export async function setAnalyticsStartDate(
  value: string | null,
  userId: number,
): Promise<void> {
  if (value !== null) {
    try {
      parseOperationalDateInput(value);
    } catch {
      throw new ServiceError("تاريخ غير صالح — الصيغة المطلوبة YYYY-MM-DD");
    }
  }

  const previous = await readAnalyticsStartDateRaw();

  await prisma.$transaction(async (tx) => {
    if (value === null) {
      await tx.systemSetting.deleteMany({
        where: { key: ANALYTICS_START_DATE_KEY },
      });
    } else {
      await tx.systemSetting.upsert({
        where: { key: ANALYTICS_START_DATE_KEY },
        create: { key: ANALYTICS_START_DATE_KEY, value },
        update: { value },
      });
    }

    await logAudit(tx, {
      userId,
      action: "update",
      entityType: "SystemSetting",
      entityId: ANALYTICS_START_DATE_KEY,
      details: { previous, next: value },
    });
  });

  revalidateTag(SETTINGS_CACHE_TAG, "max");
  revalidateTag(DASHBOARD_STATS_CACHE_TAG, "max");
}
