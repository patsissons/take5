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
});
