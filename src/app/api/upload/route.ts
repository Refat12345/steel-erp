import { NextRequest } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { getApiSession, unauthorized, forbidden, badRequest, ok, hasPermission } from "@/lib/api-utils";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export async function POST(req: NextRequest) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!hasPermission(session, "contract.create") && !hasPermission(session, "contract.edit")) {
    return forbidden();
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return badRequest("fileNotSelected");

  if (file.size > MAX_SIZE) {
    return badRequest("fileTooLarge10Mb");
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return badRequest("fileTypePdfImagesWord");
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  const timestamp = Date.now();
  const safeOriginal = file.name.replace(/[^a-zA-Z0-9._\-\u0600-\u06FF]/g, "_");
  const fileName = `${timestamp}_${safeOriginal}`;
  const filePath = path.join(UPLOAD_DIR, fileName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  return ok({
    filePath: `uploads/${fileName}`,
    fileName: file.name,
    fileSize: file.size,
  });
}
