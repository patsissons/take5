import { formatUsd } from "@/lib/cost";
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
  if (model.pricing?.kind === "per-second") {
    const cheapest = Math.min(
      ...model.pricing.rates.map((r) => r.usdPerSecond),
    );
    out.push(`from ${formatUsd(cheapest)}/s`);
  } else if (model.pricing?.kind === "per-video") {
    out.push(`${formatUsd(model.pricing.usd)}/video`);
  }
  return out;
}
