import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/api-utils";
import { cleanupExpiredIdempotencyKeys } from "@/lib/idempotency";
import { logger } from "@/lib/logger";

/**
 * Delete expired rows from `idempotency_keys`.
 *
 * Authorised in either of two ways:
 *  1. `Authorization: Bearer <CLEANUP_SECRET>` — for scheduled jobs
 *     (Vercel Cron, pg_cron, Windows Task Scheduler, etc.).
 *  2. An authenticated admin session — for on-demand manual triggers.
 *
 * Safe to call as often as you like; it is a single indexed DELETE.
 *
 * Recommended schedule: daily (off-hours). See deployment docs for trigger
 * options.
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CLEANUP_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const presented =
    authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";

  let authorised = false;
  let actor = "scheduler";

  if (secret && presented && timingSafeEqual(presented, secret)) {
    authorised = true;
  } else {
    const session = await getApiSession();
    if (session && session.role === "admin") {
      authorised = true;
      actor = `admin:${session.username}`;
    }
  }

  if (!authorised) {
    return NextResponse.json(
      { success: false, error: "غير مصرح بالدخول" },
      { status: 401 },
    );
  }

  try {
    const deleted = await cleanupExpiredIdempotencyKeys();
    logger.info({ actor, deleted }, "idempotency cleanup triggered");
    return NextResponse.json({ success: true, deleted });
  } catch (err) {
    logger.error({ err }, "idempotency cleanup failed");
    return NextResponse.json(
      { success: false, error: "فشل تنظيف مفاتيح التكرار" },
      { status: 500 },
    );
  }
}

/**
 * Constant-time string comparison so a timing attacker can't guess the secret
 * byte-by-byte from response latency.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// GET is allowed so that simple cron services (Windows Task Scheduler, curl
// in a crontab, etc.) which only emit GET requests can still trigger cleanup.
// The body-less GET carries no risk of CSRF because the action is idempotent
// and only authorised via the bearer header or an admin session.
export async function GET(req: NextRequest) {
  return handle(req);
}
