import { formatUsd } from "@/lib/cost";
import { cheapestPerImage, cheapestPerSecond } from "@/lib/model-cost";
import type { MediaModel } from "@/providers/types";

/** Short capability summary shown on each model. */
export function badges(model: MediaModel): string[] {
  return model.kind === "image" ? imageBadges(model) : videoBadges(model);
}

function videoBadges(model: MediaModel): string[] {
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

function imageBadges(model: MediaModel): string[] {
  const out = model.imageRequired ? ["edit only"] : ["text→image"];
  if (model.referenceImages && !model.imageRequired) out.push("image edit");
  const resolutions = model.resolutions ?? [];
  if (resolutions.length) {
    const first = resolutions[0]!;
    const last = resolutions[resolutions.length - 1]!;
    out.push(first === last ? first : `${first}–${last}`);
  }
  const pricing = model.pricing;
  if (pricing?.kind === "per-image") {
    const cheapest = cheapestPerImage(pricing)!;
    out.push(
      `${pricing.rates.length > 1 ? "from " : ""}${formatUsd(cheapest)}/image`,
    );
  } else if (pricing?.kind === "per-megapixel") {
    out.push(`${formatUsd(pricing.usd)}/MP`);
  }
  return out;
}
