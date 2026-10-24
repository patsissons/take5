import type { ImageRole, MediaModel } from "@/providers/types";

export const DEFAULT_DURATION = 5;

/** The nearest supported duration to five seconds. */
export function defaultDuration(model: MediaModel): number {
  if (!model.durations?.length) return DEFAULT_DURATION;
  return model.durations.reduce((best, d) =>
    Math.abs(d - DEFAULT_DURATION) < Math.abs(best - DEFAULT_DURATION)
      ? d
      : best,
  );
}

/** 720p for a clip, 1K for a still, when offered. */
export function defaultResolution(model: MediaModel): string | undefined {
  const list = model.resolutions;
  if (!list?.length) return undefined;
  const preferred = model.kind === "image" ? "1k" : "720p";
  return list.find((r) => r.toLowerCase() === preferred) ?? list[0];
}

/** 16:9 for a clip, square for a still, when offered. */
export function defaultAspectRatio(model: MediaModel): string | undefined {
  const list = model.aspectRatios;
  if (!list?.length) return undefined;
  const preferred = model.kind === "image" ? "1:1" : "16:9";
  return list.find((r) => r === preferred) ?? list[0];
}

/** Roles the model accepts for an extra image. */
export function imageRoles(model: MediaModel): ImageRole[] {
  const roles: ImageRole[] = [...model.frameImages];
  if (model.referenceImages) roles.push("reference");
  return roles;
}
