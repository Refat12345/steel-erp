import { NextRequest } from "next/server";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  handleServiceError,
} from "@/lib/api-utils";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import {
  canEditMillLiveProductSize,
  canOpenMillLiveDashboard,
} from "@/lib/mill-live-access";
import { setMillLiveProductSizeId } from "@/lib/services/settings.service";
import { localizedSize } from "@/lib/localized-name";
import { millLiveProductSizeSchema } from "@/lib/validators/mill-live";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (
    !canOpenMillLiveDashboard({
      username: session.username,
      permissions: session.permissions,
    }) ||
    !canEditMillLiveProductSize(session.permissions)
  ) {
    return forbidden();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalidRequest");
  }

  const parsed = millLiveProductSizeSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "invalidData");
  }

  try {
    const size = await setMillLiveProductSizeId(parsed.data.sizeId, session.userId);
    const locale = await getRequestLocale();

    logger.info(
      {
        userId: session.userId,
        username: session.username,
        sizeId: size.id,
      },
      "mill-live product size updated",
    );

    return ok({
      productSizeId: size.id,
      productSizeLabel: localizedSize(size, locale),
    });
  } catch (err) {
    return handleServiceError(err);
  }
}
