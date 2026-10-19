import type { ImageRole, VideoModel } from "@/providers/types";

export const DEFAULT_DURATION = 5;

/** The nearest supported duration to five seconds. */
export function defaultDuration(model: VideoModel): number {
  if (!model.durations?.length) return DEFAULT_DURATION;
  return model.durations.reduce((best, d) =>
    Math.abs(d - DEFAULT_DURATION) < Math.abs(best - DEFAULT_DURATION)
      ? d
      : best,
  );
}

export function defaultResolution(model: VideoModel): string | undefined {
  const list = model.resolutions;
  if (!list?.length) return undefined;
  return list.find((r) => r === "720p") ?? list[0];
}

export function defaultAspectRatio(model: VideoModel): string | undefined {
  const list = model.aspectRatios;
  if (!list?.length) return undefined;
  return list.find((r) => r === "16:9") ?? list[0];
}

/** Roles the model accepts for an extra image. */
export function imageRoles(model: VideoModel): ImageRole[] {
  const roles: ImageRole[] = [...model.frameImages];
  if (model.referenceImages) roles.push("reference");
  return roles;
}
