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
import { addAttachment } from "@/lib/services/billet-receipt.service";
import { compressPdfBuffer } from "@/lib/server/pdf-compress";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "billet-receipts");

const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;
const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
const MAX_STORED_PDF_SIZE = 10 * 1024 * 1024;

type DetectedType = { extension: "jpg" | "png" | "pdf" | "webp" };

function detectFileType(buffer: Buffer): DetectedType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: "jpg" };
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { extension: "png" };
  }
  // PDF files normally start with %PDF, but the spec allows it to appear
  // within the first 1024 bytes. Some scanners/exporters add a small prefix.
  if (buffer.subarray(0, 1024).includes(Buffer.from("%PDF"))) {
    return { extension: "pdf" };
  }
  // RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { extension: "webp" };
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "billet.receipt.upload")) return forbidden();

  const { id } = await params;
  const receiptId = parseInt(id, 10);
  if (isNaN(receiptId)) return badRequest("معرّف غير صالح");

  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const length = parseInt(contentLength, 10);
    if (Number.isFinite(length) && length > MAX_UPLOAD_SIZE) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `حجم الملف يتجاوز الحد الأقصى المسموح (${MAX_UPLOAD_SIZE / (1024 * 1024)} ميغابايت)`,
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
  if (!file) return badRequest("لم يتم اختيار ملف");
  if (file.size > MAX_UPLOAD_SIZE) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `حجم الملف يتجاوز الحد الأقصى المسموح (${MAX_UPLOAD_SIZE / (1024 * 1024)} ميغابايت)`,
      }),
      { status: 413, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  const buffer: Buffer = Buffer.from(await file.arrayBuffer());
  const detected = detectFileType(buffer);
  if (!detected) {
    return badRequest("نوع الملف غير مسموح — يُقبل PDF أو صور (JPEG/PNG/WebP)");
  }

  let storedBuffer: Buffer = buffer;
  let storedFileSize = file.size;
  if (detected.extension === "pdf") {
    const compressed = await compressPdfBuffer(buffer);
    if (compressed && compressed.length < buffer.length) {
      storedBuffer = compressed;
      storedFileSize = compressed.length;
    }

    if (storedBuffer.length > MAX_STORED_PDF_SIZE) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `حجم PDF بعد الضغط يتجاوز الحد المقبول (${MAX_STORED_PDF_SIZE / (1024 * 1024)} ميغابايت). جرّب حفظه بجودة أقل أو تقسيمه.`,
        }),
        { status: 413, headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }
  } else if (storedBuffer.length > MAX_IMAGE_FILE_SIZE) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `حجم الصورة يتجاوز الحد الأقصى المسموح (${MAX_IMAGE_FILE_SIZE / (1024 * 1024)} ميغابايت)`,
      }),
      { status: 413, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  const storedName = `${randomUUID()}.${detected.extension}`;
  const filePath = path.join(UPLOAD_DIR, storedName);
  const relativePath = `uploads/billet-receipts/${storedName}`;

  await writeFile(filePath, storedBuffer);

  try {
    const attachment = await addAttachment(
      receiptId,
      { filePath: relativePath, fileName: file.name, fileSize: storedFileSize },
      session.userId,
    );
    return ok(attachment);
  } catch (e) {
    await unlink(filePath).catch(() => {});
    return handleServiceError(e);
  }
}
