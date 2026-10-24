import { DEFAULT_DURATION } from "@/lib/composer-defaults";
import type { MediaKind, MediaModel, Pricing } from "@/providers/types";

/** The lowest per-second rate a model lists, if it is priced per second. */
export function cheapestPerSecond(pricing: Pricing | null): number | undefined {
  if (pricing?.kind !== "per-second" || !pricing.rates.length) return undefined;
  return Math.min(...pricing.rates.map((rate) => rate.usdPerSecond));
}

/** The lowest per-image rate a model lists, if it is priced per image. */
export function cheapestPerImage(pricing: Pricing | null): number | undefined {
  if (pricing?.kind !== "per-image" || !pricing.rates.length) return undefined;
  return Math.min(...pricing.rates.map((rate) => rate.usd));
}

/**
 * What the cheapest unit costs on this model: a five-second clip for video,
 * one image (a megapixel, for megapixel prices) for stills. The one number
 * the picker can compare across a kind's price shapes.
 */
export function unitCost(
  model: Pick<MediaModel, "pricing">,
): number | undefined {
  const pricing = model.pricing;
  if (pricing?.kind === "per-video") return pricing.usd;
  if (pricing?.kind === "per-megapixel") return pricing.usd;
  if (pricing?.kind === "per-image") return cheapestPerImage(pricing);
  const rate = cheapestPerSecond(pricing);
  return rate === undefined ? undefined : rate * DEFAULT_DURATION;
}

/** What unitCost prices, for labels. */
export function unitLabel(kind: MediaKind): string {
  return kind === "image" ? "image" : `${DEFAULT_DURATION}s clip`;
}

export interface CostRange {
  min: number;
  max: number;
}

/** The cheapest and dearest unit; undefined when there is nothing to range over. */
export function costBounds(
  models: Array<Pick<MediaModel, "pricing">>,
): CostRange | undefined {
  const costs = models
    .map(unitCost)
    .filter((cost): cost is number => cost !== undefined);
  if (costs.length < 2) return undefined;
  const range = { min: Math.min(...costs), max: Math.max(...costs) };
  return range.min < range.max ? range : undefined;
}

/**
 * Whether a model's unit cost falls in the chosen range. `null` means the
 * range is untouched: then everything passes, unpriced models included.
 */
export function inCostRange(
  model: Pick<MediaModel, "pricing">,
  range: CostRange | null,
): boolean {
  if (!range) return true;
  const cost = unitCost(model);
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
