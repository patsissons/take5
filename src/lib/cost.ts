import type { PerSecondRate, Pricing, MediaRequest } from "@/providers/types";

/**
 * A best-effort estimate from a model's price list: the per-second rate
 * whose conditions best match the request, times the duration. Undefined
 * when there is nothing to go on.
 */
export function estimateCost(
  pricing: Pricing | null,
  req: Pick<MediaRequest, "duration" | "resolution" | "audio" | "images">,
): number | undefined {
  if (!pricing) return undefined;
  if (pricing.kind === "per-video") return pricing.usd;
  if (pricing.kind !== "per-second" || !req.duration) return undefined;
  const rate = bestRate(pricing.rates, req);
  return rate ? rate.usdPerSecond * req.duration : undefined;
}

export function bestRate(
  rates: PerSecondRate[],
  req: Pick<MediaRequest, "resolution" | "audio" | "images">,
): PerSecondRate | undefined {
  const hasImage = req.images.length > 0;
  let best: { rate: PerSecondRate; score: number } | undefined;
  for (const rate of rates) {
    let score = 0;
    if (rate.resolution !== undefined) {
      if (!req.resolution || !sameResolution(rate.resolution, req.resolution)) {
        continue;
      }
      score += 4;
    }
    if (rate.audio !== undefined) {
      if (req.audio === undefined || rate.audio !== req.audio) continue;
      score += 2;
    }
    if (rate.imageInput !== undefined) {
      if (rate.imageInput !== hasImage) continue;
      score += 1;
    }
    if (!best || score > best.score) best = { rate, score };
  }
  return best?.rate;
}

function sameResolution(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function formatUsd(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3).replace(/0$/, "")}`;
  return `$${usd.toFixed(2)}`;
}
