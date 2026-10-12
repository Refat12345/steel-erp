import { NextRequest } from "next/server";
import { unlink } from "fs/promises";
import path from "path";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  handleServiceError,
  tooManyRequests,
} from "@/lib/api-utils";
import { checkRateLimit, SCALE_WRITE_RATE_LIMIT } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { deleteTruckPhoto } from "@/lib/services/truck.service";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "trucks");

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "scale.upload_photo")) return forbidden();

  const { id, photoId } = await params;
  const truckId = parseInt(id, 10);
  const pid = parseInt(photoId, 10);
  if (isNaN(truckId) || isNaN(pid)) return badRequest("invalidId");

  const rl = checkRateLimit(`scale:${session.userId}`, SCALE_WRITE_RATE_LIMIT);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  let photo;
  try {
    photo = await deleteTruckPhoto(truckId, pid, session.userId);
  } catch (e) {
    return handleServiceError(e);
  }

  // Never unlink outside uploads/trucks, whatever the stored path says.
  const fullPath = path.resolve(process.cwd(), photo.filePath);
  if (fullPath.startsWith(UPLOAD_DIR + path.sep)) {
    await unlink(fullPath).catch((err: unknown) => {
      logger.warn({ truckId, photoId: pid, err }, "photo file unlink failed");
    });
  } else {
    logger.warn({ truckId, photoId: pid }, "photo file path outside upload dir; not unlinked");
  }

  return ok({ deleted: true });
}
