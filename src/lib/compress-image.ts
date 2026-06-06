/**
 * Client-side image pipeline: every raster image is decoded, scaled to fit
 * within a max bounding box, and re-encoded as JPEG for predictable storage size.
 *
 * Non-image files are returned unchanged (callers must only pass images when needed).
 */

export type CompressImagePreset = "contract" | "truck";

type CompressImageConfig = {
  maxDimension: number;
  initialQuality: number;
  targetMaxBytes: number;
  minQuality: number;
  minMaxDimension: number;
  maxAttempts: number;
};

const COMPRESS_PRESETS: Record<CompressImagePreset, CompressImageConfig> = {
  contract: {
    maxDimension: 1920,
    initialQuality: 0.8,
    targetMaxBytes: 2 * 1024 * 1024, // ~2 MB goal
    minQuality: 0.35,
    minMaxDimension: 640,
    maxAttempts: 56,
  },
  truck: {
    maxDimension: 1280,
    initialQuality: 0.72,
    targetMaxBytes: 700 * 1024, // truck photos should stay light for VPS storage
    minQuality: 0.3,
    minMaxDimension: 540,
    maxAttempts: 56,
  },
};

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
 * Re-encode an image file to JPEG, then tighten quality / dimensions until it
 * reaches the selected storage budget when possible. Non-image `File` is returned as-is.
 */
export async function compressImage(
  file: File,
  preset: CompressImagePreset = "contract",
): Promise<File> {
  if (!file.type.startsWith("image/")) {
    return file;
  }

  const config = COMPRESS_PRESETS[preset];

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

  let maxDim = config.maxDimension;
  let quality = config.initialQuality;
  let bestOverBudget: Blob | null = null;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    const blob = await encodeOnce(img, iw, ih, maxDim, quality);
    if (!blob) {
      break;
    }

    if (blob.size <= config.targetMaxBytes) {
      return new File([blob], `${stripExtension(file.name)}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    }

    if (!bestOverBudget || blob.size < bestOverBudget.size) {
      bestOverBudget = blob;
    }

    if (quality > config.minQuality + 0.008) {
      quality = Math.max(config.minQuality, quality - 0.06);
      continue;
    }

    if (maxDim > config.minMaxDimension) {
      maxDim = Math.max(config.minMaxDimension, Math.floor(maxDim * 0.86));
      quality = config.initialQuality;
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
