import { describe, expect, it } from "vitest";
import { badges } from "./model-badges";
import { customModel } from "./use-settings";

describe("badges", () => {
  it("summarises capabilities and the cheapest rate", () => {
    expect(badges(customModel("fal", "x"))).toEqual([
      "text→video",
      "image→video",
    ]);
    expect(
      badges({
        ...customModel("fal", "x"),
        frameImages: [],
        audio: true,
        durations: [5, 10],
        pricing: {
          kind: "per-second",
          rates: [
            { usdPerSecond: 0.1 },
            { usdPerSecond: 0.05, resolution: "480p" },
          ],
        },
      }),
    ).toEqual(["text→video", "audio", "5–10s", "from $0.05/s"]);
    expect(
      badges({
        ...customModel("fal", "x"),
        durations: [8],
        pricing: { kind: "per-video", usd: 1 },
      }),
    ).toEqual(["text→video", "image→video", "8s", "$1.00/video"]);
  });

  it("summarises image models by edit support, resolutions and price", () => {
    const still = customModel("fal", "x", "image");
    expect(badges(still)).toEqual(["text→image", "image edit"]);
    expect(
      badges({
        ...still,
        referenceImages: false,
        resolutions: ["1K", "2K", "4K"],
        pricing: {
          kind: "per-image",
          rates: [
            { usd: 0.067, resolution: "1K" },
            { usd: 0.151, resolution: "4K" },
          ],
        },
      }),
    ).toEqual(["text→image", "1K–4K", "from $0.067/image"]);
    expect(
      badges({
        ...still,
        imageRequired: true,
        pricing: { kind: "per-megapixel", usd: 0.03 },
      }),
    ).toEqual(["edit only", "$0.03/MP"]);
    expect(
      badges({
        ...still,
        pricing: { kind: "per-image", rates: [{ usd: 0.02 }] },
      }),
    ).toEqual(["text→image", "image edit", "$0.02/image"]);
  });
});
