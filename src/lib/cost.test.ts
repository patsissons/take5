import { describe, expect, it } from "vitest";
import { estimateCost, formatUsd } from "./cost";

const rates = {
  kind: "per-second" as const,
  rates: [
    { usdPerSecond: 0.1 },
    { usdPerSecond: 0.05, resolution: "480p" },
    { usdPerSecond: 0.2, resolution: "720p", audio: true },
    { usdPerSecond: 0.15, resolution: "720p", audio: false },
    { usdPerSecond: 0.3, imageInput: true },
  ],
};

describe("estimateCost", () => {
  it("picks the most specific matching rate", () => {
    expect(
      estimateCost(rates, {
        duration: 5,
        resolution: "720p",
        audio: true,
        images: [],
      }),
    ).toBeCloseTo(1);
    expect(
      estimateCost(rates, { duration: 5, resolution: "480p", images: [] }),
    ).toBeCloseTo(0.25);
    expect(estimateCost(rates, { duration: 2, images: [] })).toBeCloseTo(0.2);
    expect(
      estimateCost(rates, {
        duration: 2,
        images: [{ role: "first_frame", dataUrl: "d" }],
      }),
    ).toBeCloseTo(0.6);
  });

  it("falls back to the unconditional rate for a resolution it has no price for", () => {
    expect(
      estimateCost(rates, { duration: 1, resolution: "4K", images: [] }),
    ).toBeCloseTo(0.1);
  });

  it("gives up without a duration or a usable price list", () => {
    expect(estimateCost(rates, { images: [] })).toBeUndefined();
    expect(estimateCost(null, { duration: 5, images: [] })).toBeUndefined();
    expect(
      estimateCost({ kind: "unknown", note: "n" }, { duration: 5, images: [] }),
    ).toBeUndefined();
    expect(
      estimateCost({ kind: "per-video", usd: 2 }, { duration: 5, images: [] }),
    ).toBe(2);
  });
});

describe("formatUsd", () => {
  it("keeps cents readable", () => {
    expect(formatUsd(0.004)).toBe("$0.0040");
    expect(formatUsd(0.25)).toBe("$0.25");
    expect(formatUsd(0.125)).toBe("$0.125");
    expect(formatUsd(3)).toBe("$3.00");
  });
});
