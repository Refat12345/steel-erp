import {
  getApiSession,
  unauthorized,
  forbidden,
  ok,
  handleServiceError,
} from "@/lib/api-utils";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import {
  canEditMillLiveProductSize,
  canOpenMillLiveDashboard,
} from "@/lib/mill-live-access";
import {
  getLatestMillLiveSnapshot,
  listMillLiveSizeOptions,
  type MillLiveCurrentResponse,
} from "@/lib/services/mill-live.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (
    !canOpenMillLiveDashboard({
      username: session.username,
      permissions: session.permissions,
    })
  ) {
    return forbidden();
  }

  try {
    const locale = await getRequestLocale();
    const canEdit = canEditMillLiveProductSize(session.permissions);
    const [snapshot, sizes] = await Promise.all([
      getLatestMillLiveSnapshot(locale),
      canEdit ? listMillLiveSizeOptions(locale) : Promise.resolve([]),
    ]);

    if (
      canEdit &&
      snapshot.productSizeId != null &&
      snapshot.productSizeLabel &&
      !sizes.some((s) => s.id === snapshot.productSizeId)
    ) {
      sizes.unshift({
        id: snapshot.productSizeId,
        displayName: snapshot.productSizeLabel,
      });
    }

    const data: MillLiveCurrentResponse = {
      ...snapshot,
      canEditProductSize: canEdit,
      sizes,
    };
    return ok(data);
  } catch (err) {
    return handleServiceError(err);
  }
}
