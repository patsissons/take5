import type {
  MediaRequest,
  PerImageRate,
  PerSecondRate,
  Pricing,
} from "@/providers/types";

/**
 * A best-effort estimate from a model's price list: the per-second rate
 * whose conditions best match the request, times the duration; for a still,
 * the image rate for its resolution or the megapixel price times its size.
 * Undefined when there is nothing to go on.
 */
export function estimateCost(
  pricing: Pricing | null,
  req: Pick<
    MediaRequest,
    "duration" | "resolution" | "size" | "audio" | "images"
  >,
): number | undefined {
  if (!pricing) return undefined;
  if (pricing.kind === "per-video") return pricing.usd;
  if (pricing.kind === "per-image") {
    return imageRate(pricing.rates, req.resolution)?.usd;
  }
  if (pricing.kind === "per-megapixel") return pricing.usd * megapixelsOf(req);
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

/** The rate for this resolution, else the unconditional one. */
export function imageRate(
  rates: PerImageRate[],
  resolution: string | undefined,
): PerImageRate | undefined {
  const exact = resolution
    ? rates.find(
        (rate) =>
          rate.resolution !== undefined &&
          sameResolution(rate.resolution, resolution),
      )
    : undefined;
  return exact ?? rates.find((rate) => rate.resolution === undefined);
}

/**
 * Whole megapixels a still will be billed for (providers round up): from an
 * exact WIDTHxHEIGHT size, or a "1K"-style resolution as a square of that
 * edge; one when neither says.
 */
export function megapixelsOf(
  req: Pick<MediaRequest, "resolution" | "size">,
): number {
  const size = /^(\d+)\s*x\s*(\d+)$/i.exec(req.size ?? "");
  if (size) return Math.max(1, Math.ceil((+size[1]! * +size[2]!) / 1e6));
  const edge = /^(\d+(?:\.\d+)?)k$/i.exec(req.resolution ?? "");
  if (edge) return Math.max(1, Math.ceil((+edge[1]! * 1024) ** 2 / 1e6));
  return 1;
}

function sameResolution(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function formatUsd(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3).replace(/0$/, "")}`;
  return `$${usd.toFixed(2)}`;
}
