/**
 * A small JPEG for the history gallery: the first frame of a video, or the
 * image itself scaled down.
 */
export const THUMBNAIL_WIDTH = 320;

export function captureThumbnail(
  blob: Blob,
  timeoutMs = 8000,
): Promise<string | undefined> {
  if (blob.type.startsWith("image/")) return imageThumbnail(blob);
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(undefined);
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    const timer = setTimeout(finish, timeoutMs);
    let settled = false;

    function finish(dataUrl?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(dataUrl);
    }

    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.addEventListener("error", () => finish(), { once: true });
    video.addEventListener(
      "loadeddata",
      () => {
        // Seek a little in: frame 0 is often black.
        video.currentTime = Math.min(0.1, (video.duration || 1) / 10);
      },
      { once: true },
    );
    video.addEventListener(
      "seeked",
      () => {
        try {
          const scale = THUMBNAIL_WIDTH / (video.videoWidth || THUMBNAIL_WIDTH);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(
            (video.videoWidth || THUMBNAIL_WIDTH) * scale,
          );
          canvas.height = Math.round((video.videoHeight || 180) * scale);
          const context = canvas.getContext("2d");
          if (!context) return finish();
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL("image/jpeg", 0.8));
        } catch {
          finish();
        }
      },
      { once: true },
    );
    video.src = url;
  });
}

/** Undefined when the browser cannot decode the image (an SVG, say). */
async function imageThumbnail(blob: Blob): Promise<string | undefined> {
  if (
    typeof document === "undefined" ||
    typeof createImageBitmap !== "function"
  )
    return undefined;
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, THUMBNAIL_WIDTH / (bitmap.width || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return undefined;
  }
}
