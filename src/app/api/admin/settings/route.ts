import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import {
  getAnalyticsStartDateValue,
  setAnalyticsStartDate,
} from "@/lib/services/settings.service";
import { logger } from "@/lib/logger";

const SETTINGS_PERMISSION = "settings.edit";

const updateSchema = z.object({
  analyticsStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDateYyyyMmDd")
    .nullable(),
});

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, SETTINGS_PERMISSION)) return forbidden();

  try {
    const analyticsStartDate = await getAnalyticsStartDateValue();
    return NextResponse.json({ success: true, data: { analyticsStartDate } });
  } catch (e) {
    return handleServiceError(e);
  }
}

export async function PUT(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, SETTINGS_PERMISSION)) return forbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalidRequest");
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "invalidData");
  }

  try {
    await setAnalyticsStartDate(parsed.data.analyticsStartDate, session.userId);
    logger.info(
      {
        userId: session.userId,
        username: session.username,
        analyticsStartDate: parsed.data.analyticsStartDate,
      },
      "analytics start date updated",
    );
    return NextResponse.json({
      success: true,
      data: { analyticsStartDate: parsed.data.analyticsStartDate },
    });
  } catch (e) {
    return handleServiceError(e);
  }
}
