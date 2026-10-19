/**
 * Images are prepared entirely in the browser: downscaled on a canvas and
 * turned into a JPEG data URL that is sent inline to the provider, so the
 * original file is never uploaded anywhere.
 */
export const MAX_EDGE = 1280;
export const JPEG_QUALITY = 0.88;

/** The size that fits `maxEdge` without upscaling, keeping the ratio. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function isImageFile(file: File | null | undefined): file is File {
  return !!file && file.type.startsWith("image/");
}

/** The first image file in a drop or paste, if any. */
export function imageFromTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (isImageFile(file)) return file;
    }
  }
  return Array.from(data.files ?? []).find(isImageFile) ?? null;
}

export async function toDataUrl(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}

/** Rough byte size of a base64 data URL's payload. */
export function dataUrlBytes(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((payload.length * 3) / 4);
}
