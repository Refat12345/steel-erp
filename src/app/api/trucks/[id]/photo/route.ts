import { NextRequest } from "next/server";
import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { uploadPhoto } from "@/lib/services/truck.service";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "trucks");
const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "scale.upload_photo")) return forbidden();

  const { id } = await params;
  const truckId = parseInt(id, 10);
  if (isNaN(truckId)) return badRequest("معرّف غير صالح");

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return badRequest("بيانات غير صالحة");
  }

  const file = formData.get("file") as File | null;
  if (!file) return badRequest("لم يتم اختيار صورة");
  if (file.size > MAX_SIZE) return badRequest("حجم الصورة يتجاوز الحد المسموح (10 ميغابايت)");
  if (!ALLOWED_TYPES.includes(file.type)) return badRequest("نوع الملف غير مسموح — يُقبل JPEG أو PNG أو WebP");

  await mkdir(UPLOAD_DIR, { recursive: true });

  const timestamp = Date.now();
  const ext = file.name.split(".").pop() || "jpg";
  const fileName = `truck_${truckId}_${timestamp}.${ext}`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const relativePath = `uploads/trucks/${fileName}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  try {
    const photo = await uploadPhoto(truckId, relativePath, session.userId);
    return ok(photo);
  } catch (e) {
    // Prevent orphan file on disk if DB insert (or status check inside
    // uploadPhoto) fails. Swallow unlink errors — the primary error is
    // what the client needs to see.
    await unlink(filePath).catch(() => {});
    return handleServiceError(e);
  }
}
