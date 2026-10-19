import { describe, expect, it } from "vitest";
import {
  COST_STEPS,
  clipCost,
  costAt,
  costBounds,
  inCostRange,
} from "./model-cost";
import type { Pricing } from "@/providers/types";

const priced = (pricing: Pricing | null) => ({ pricing });
const perSecond = (...rates: number[]) =>
  priced({
    kind: "per-second",
    rates: rates.map((usdPerSecond) => ({ usdPerSecond })),
  });

describe("clipCost", () => {
  it("prices the cheapest five-second clip", () => {
    expect(clipCost(perSecond(0.1, 0.05))).toBeCloseTo(0.25);
    expect(clipCost(priced({ kind: "per-video", usd: 0.4 }))).toBe(0.4);
    expect(
      clipCost(priced({ kind: "unknown", note: "tokens" })),
    ).toBeUndefined();
    expect(clipCost(priced(null))).toBeUndefined();
  });
});

describe("costBounds", () => {
  it("spans the priced models and needs two different prices", () => {
    expect(
      costBounds([
        perSecond(0.01),
        priced(null),
        priced({ kind: "per-video", usd: 2 }),
      ]),
    ).toEqual({ min: 0.05, max: 2 });
    expect(costBounds([perSecond(0.01), priced(null)])).toBeUndefined();
    expect(costBounds([perSecond(0.01), perSecond(0.01)])).toBeUndefined();
  });
});

describe("inCostRange", () => {
  it("lets everything through until the range is narrowed", () => {
    expect(inCostRange(priced(null), null)).toBe(true);
    const range = { min: 0.1, max: 1 };
    expect(inCostRange(priced(null), range)).toBe(false);
    expect(inCostRange(perSecond(0.02), range)).toBe(true);
    expect(inCostRange(perSecond(0.01), range)).toBe(false);
    expect(inCostRange(priced({ kind: "per-video", usd: 1 }), range)).toBe(
      true,
    );
  });
});

describe("costAt", () => {
  const bounds = { min: 0.05, max: 5 };

  it("hits the bounds exactly at the ends and is logarithmic between", () => {
    expect(costAt(0, bounds)).toBe(0.05);
    expect(costAt(COST_STEPS, bounds)).toBe(5);
    // Half way on a log scale from 0.05 to 5 is 0.5.
    expect(costAt(COST_STEPS / 2, bounds)).toBeCloseTo(0.5);
  });

  it("copes with a free model", () => {
    const free = { min: 0, max: 1 };
    expect(costAt(0, free)).toBe(0);
    expect(costAt(COST_STEPS / 2, free)).toBeGreaterThan(0);
  });
});
