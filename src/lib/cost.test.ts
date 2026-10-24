import { describe, expect, it } from "vitest";
import { estimateCost, formatUsd, megapixelsOf } from "./cost";

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

describe("estimateCost for stills", () => {
  const perImage = {
    kind: "per-image" as const,
    rates: [
      { usd: 0.067, resolution: "1K" },
      { usd: 0.151, resolution: "4K" },
    ],
  };

  it("takes the image rate for the resolution, in any case", () => {
    expect(estimateCost(perImage, { resolution: "4k", images: [] })).toBe(
      0.151,
    );
    expect(estimateCost(perImage, { resolution: "1K", images: [] })).toBe(
      0.067,
    );
    expect(
      estimateCost(perImage, { resolution: "2K", images: [] }),
    ).toBeUndefined();
    expect(
      estimateCost(
        { kind: "per-image", rates: [{ usd: 0.02 }] },
        { resolution: "2K", images: [] },
      ),
    ).toBe(0.02);
  });

  it("multiplies a megapixel price by the billed megapixels", () => {
    const perMp = { kind: "per-megapixel" as const, usd: 0.03 };
    expect(estimateCost(perMp, { images: [] })).toBeCloseTo(0.03);
    expect(estimateCost(perMp, { resolution: "2K", images: [] })).toBeCloseTo(
      0.15,
    );
  });
});

describe("megapixelsOf", () => {
  it("rounds an exact size or a K resolution up to whole megapixels", () => {
    expect(megapixelsOf({ size: "1024x1024" })).toBe(2);
    expect(megapixelsOf({ size: "1000x1000" })).toBe(1);
    expect(megapixelsOf({ resolution: "1K" })).toBe(2);
    expect(megapixelsOf({ resolution: "0.5k" })).toBe(1);
    expect(megapixelsOf({ resolution: "4K" })).toBe(17);
    expect(megapixelsOf({ resolution: "720p" })).toBe(1);
    expect(megapixelsOf({})).toBe(1);
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
