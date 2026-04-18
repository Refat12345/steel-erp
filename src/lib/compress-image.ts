/**
 * Client-side image pipeline: every raster image is decoded, scaled to fit
 * within a max bounding box, and re-encoded as JPEG for predictable storage size.
 *
 * Non-image files are returned unchanged (callers must only pass images when needed).
 */

const MAX_DIMENSION = 1920;
const INITIAL_QUALITY = 0.8;
const TARGET_MAX_BYTES = 2 * 1024 * 1024; // ~2 MB goal
const MIN_QUALITY = 0.35;
const MIN_MAX_DIMENSION = 640;
const MAX_ATTEMPTS = 56;

function stripExtension(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim();
  return base.replace(/[^\w\u0600-\u06FF.-]/g, "_") || "image";
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode_failed"));
    };
    img.src = url;
  });
}

function fitDimensions(
  intrinsicWidth: number,
  intrinsicHeight: number,
  maxDim: number,
): { width: number; height: number } {
  const ratio = Math.min(maxDim / intrinsicWidth, maxDim / intrinsicHeight, 1);
  return {
    width: Math.max(1, Math.round(intrinsicWidth * ratio)),
    height: Math.max(1, Math.round(intrinsicHeight * ratio)),
  };
}

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });
}

async function encodeOnce(
  img: HTMLImageElement,
  intrinsicW: number,
  intrinsicH: number,
  maxDim: number,
  quality: number,
): Promise<Blob | null> {
  const { width, height } = fitDimensions(intrinsicW, intrinsicH, maxDim);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);
  return canvasToJpegBlob(canvas, quality);
}

/**
 * Re-encode an image file to JPEG (max edge ≤ {@link MAX_DIMENSION}, then tighten
 * quality / dimensions until under ~2 MB when possible). Non-image `File` is returned as-is.
 */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    return file;
  }

  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return file;
  }

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (iw < 1 || ih < 1) {
    return file;
  }

  let maxDim = MAX_DIMENSION;
  let quality = INITIAL_QUALITY;
  let bestOverBudget: Blob | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const blob = await encodeOnce(img, iw, ih, maxDim, quality);
    if (!blob) {
      break;
    }

    if (blob.size <= TARGET_MAX_BYTES) {
      return new File([blob], `${stripExtension(file.name)}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    }

    if (!bestOverBudget || blob.size < bestOverBudget.size) {
      bestOverBudget = blob;
    }

    if (quality > MIN_QUALITY + 0.008) {
      quality = Math.max(MIN_QUALITY, quality - 0.06);
      continue;
    }

    if (maxDim > MIN_MAX_DIMENSION) {
      maxDim = Math.max(MIN_MAX_DIMENSION, Math.floor(maxDim * 0.86));
      quality = INITIAL_QUALITY;
      continue;
    }

    break;
  }

  if (bestOverBudget) {
    return new File([bestOverBudget], `${stripExtension(file.name)}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  }

  return file;
}
