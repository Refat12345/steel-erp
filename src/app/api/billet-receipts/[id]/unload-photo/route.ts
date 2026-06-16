import { NextRequest } from "next/server";
import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import {
  getApiSession,
  unauthorized,
  forbidden,
  badRequest,
  ok,
  hasPermission,
  handleServiceError,
} from "@/lib/api-utils";
import { startUnloading } from "@/lib/services/billet-receipt.service";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "billet-receipts");

// Client-side compression targets ~700 KB; 3 MB is the safety net.
const MAX_FILE_SIZE = 3 * 1024 * 1024;

function detectImageType(
  buffer: Buffer,
): { extension: "jpg" | "png" } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: "jpg" };
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { extension: "png" };
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "billet.receipt.unload")) return forbidden();

  const { id } = await params;
  const receiptId = parseInt(id, 10);
  if (isNaN(receiptId)) return badRequest("معرّف غير صالح");

  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const length = parseInt(contentLength, 10);
    if (Number.isFinite(length) && length > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `حجم الملف يتجاوز الحد الأقصى المسموح (${MAX_FILE_SIZE / (1024 * 1024)} ميغابايت)`,
        }),
        { status: 413, headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return badRequest("بيانات غير صالحة");
  }

  const file = formData.get("file") as File | null;
  if (!file) return badRequest("لم يتم اختيار صورة");
  if (file.size > MAX_FILE_SIZE) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `حجم الملف يتجاوز الحد الأقصى المسموح (${MAX_FILE_SIZE / (1024 * 1024)} ميغابايت)`,
      }),
      { status: 413, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  const detectedType = detectImageType(buffer);
  if (!detectedType) {
    return badRequest("نوع الملف غير مسموح — يُقبل JPEG أو PNG فقط");
  }

  const fileName = `${randomUUID()}.${detectedType.extension}`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const relativePath = `uploads/billet-receipts/${fileName}`;

  await writeFile(filePath, buffer);

  try {
    const receipt = await startUnloading(receiptId, relativePath, session.userId);
    return ok(receipt);
  } catch (e) {
    await unlink(filePath).catch(() => {});
    return handleServiceError(e);
  }
}
