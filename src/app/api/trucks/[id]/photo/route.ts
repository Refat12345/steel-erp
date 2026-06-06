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
import { uploadPhoto } from "@/lib/services/truck.service";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "trucks");

/**
 * MAX_FILE_SIZE = 3 MB. Enforced in THREE places:
 *   1. Content-Length header check BEFORE reading the body (below).
 *   2. Stream-size check after FormData parsing (in case body is sent
 *      chunked without a length header, e.g. some mobile clients).
 *
 * Client-side truck compression targets ~700 KB; this cap is a safety net when
 * browser compression fails. Reading a multi-hundred-MB body only to reject it
 * afterwards is a trivial DoS vector: this pre-check rejects oversized uploads
 * within milliseconds.
 */
const MAX_FILE_SIZE = 3 * 1024 * 1024;

type DetectedImageType = {
  mimeType: "image/jpeg" | "image/png";
  extension: "jpg" | "png";
};

function detectImageType(buffer: Buffer): DetectedImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
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
    return { mimeType: "image/png", extension: "png" };
  }

  return null;
}

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

  // ── Pre-read Content-Length guard (Part 7) ─────────────────────
  // Trust but verify: a malicious client can lie about Content-Length, but
  // an honest-but-oversized upload is rejected immediately without buffering
  // 100 MB into memory. The post-parse size check below handles the liars.
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const length = parseInt(contentLength, 10);
    if (Number.isFinite(length) && length > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `حجم الملف يتجاوز الحد الأقصى المسموح (${MAX_FILE_SIZE / (1024 * 1024)} ميغابايت)`,
        }),
        {
          status: 413,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
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
  // Post-parse size check catches clients that lied about (or omitted)
  // Content-Length. `file.size` here is authoritative.
  if (file.size > MAX_FILE_SIZE) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `حجم الملف يتجاوز الحد الأقصى المسموح (${MAX_FILE_SIZE / (1024 * 1024)} ميغابايت)`,
      }),
      {
        status: 413,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
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
  const relativePath = `uploads/trucks/${fileName}`;

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
