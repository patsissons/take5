import { formatUsd } from "@/lib/cost";
import { cheapestPerSecond } from "@/lib/model-cost";
import type { VideoModel } from "@/providers/types";

/** Short capability summary shown on each model. */
export function badges(model: VideoModel): string[] {
  const out = ["text→video"];
  if (model.frameImages.length) out.push("image→video");
  if (model.audio) out.push("audio");
  if (model.durations?.length) {
    const min = Math.min(...model.durations);
    const max = Math.max(...model.durations);
    out.push(min === max ? `${min}s` : `${min}–${max}s`);
  }
  const cheapest = cheapestPerSecond(model.pricing);
  if (cheapest !== undefined) {
    out.push(`from ${formatUsd(cheapest)}/s`);
  } else if (model.pricing?.kind === "per-video") {
    out.push(`${formatUsd(model.pricing.usd)}/video`);
  }
  return out;
}
