import { DEFAULT_DURATION } from "@/lib/composer-defaults";
import type { Pricing, VideoModel } from "@/providers/types";

/** The lowest per-second rate a model lists, if it is priced per second. */
export function cheapestPerSecond(pricing: Pricing | null): number | undefined {
  if (pricing?.kind !== "per-second" || !pricing.rates.length) return undefined;
  return Math.min(...pricing.rates.map((rate) => rate.usdPerSecond));
}

/**
 * What the cheapest five-second clip costs on this model, the one number
 * the picker can compare across per-second and per-video prices.
 */
export function clipCost(
  model: Pick<VideoModel, "pricing">,
): number | undefined {
  if (model.pricing?.kind === "per-video") return model.pricing.usd;
  const rate = cheapestPerSecond(model.pricing);
  return rate === undefined ? undefined : rate * DEFAULT_DURATION;
}

export interface CostRange {
  min: number;
  max: number;
}

/** The cheapest and dearest clip; undefined when there is nothing to range over. */
export function costBounds(
  models: Array<Pick<VideoModel, "pricing">>,
): CostRange | undefined {
  const costs = models
    .map(clipCost)
    .filter((cost): cost is number => cost !== undefined);
  if (costs.length < 2) return undefined;
  const range = { min: Math.min(...costs), max: Math.max(...costs) };
  return range.min < range.max ? range : undefined;
}

/**
 * Whether a model's clip cost falls in the chosen range. `null` means the
 * range is untouched: then everything passes, unpriced models included.
 */
export function inCostRange(
  model: Pick<VideoModel, "pricing">,
  range: CostRange | null,
): boolean {
  if (!range) return true;
  const cost = clipCost(model);
  return cost !== undefined && cost >= range.min && cost <= range.max;
}

/** Slider positions; prices span orders of magnitude, so the scale is logarithmic. */
export const COST_STEPS = 100;

// Shifts a free model off zero so the logarithm stays finite.
const offset = (bounds: CostRange) => (bounds.min > 0 ? 0 : 0.01);

export function costAt(step: number, bounds: CostRange): number {
  if (step <= 0) return bounds.min;
  if (step >= COST_STEPS) return bounds.max;
  const shift = offset(bounds);
  const lo = Math.log(bounds.min + shift);
  const hi = Math.log(bounds.max + shift);
  return Math.exp(lo + ((hi - lo) * step) / COST_STEPS) - shift;
}
