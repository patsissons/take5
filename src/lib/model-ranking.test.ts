import { describe, expect, it } from "vitest";
import { arenaElo, arenaEntry, rankModels } from "./model-ranking";

const m = (id: string, name = id) => ({ id, name });
const still = (id: string, name = id) => ({ id, name, kind: "image" as const });

describe("arenaEntry", () => {
  it("matches the same family across each provider's slug style", () => {
    // OpenRouter, Gemini and xAI spellings of Veo and Grok.
    expect(arenaEntry(m("google/veo-3.1", "Google: Veo 3.1"))?.name).toBe(
      "Veo 3.1",
    );
    expect(arenaEntry(m("veo-3.1-generate-preview", "Veo 3.1"))?.name).toBe(
      "Veo 3.1",
    );
    expect(
      arenaEntry(m("grok-imagine-video-1.5", "Grok Imagine Video 1.5"))?.elo,
    ).toBe(1059);
    // fal's endpoint ids and display names.
    expect(
      arenaEntry(
        m(
          "fal-ai/kling-video/v3/pro/image-to-video",
          "Kling Video v3 Image to Video [Pro]",
        ),
      )?.name,
    ).toBe("Kling 3.0 (Pro)");
    expect(
      arenaEntry(
        m("minimax/h3-max/text-to-video", "MiniMax H3 Max Text to Video"),
      )?.name,
    ).toBe("MiniMax H3 Max");
  });

  it("keeps cheaper and pricier tiers apart from their flagship", () => {
    expect(arenaElo(m("google/veo-3.1-lite", "Google: Veo 3.1 Lite"))).toBe(
      952,
    );
    expect(arenaElo(m("veo-3.1-fast-generate-preview"))).toBe(964);
    expect(
      arenaElo(
        m("x-ai/grok-imagine-video-1.5-lite", "Grok Imagine Video 1.5 Lite"),
      ),
    ).toBe(998);
    // Listed only as Pro, so the standard tier stays unranked.
    expect(
      arenaElo(m("fal-ai/kling-video/v3/standard/text-to-video")),
    ).toBeUndefined();
    // Seedance 2.0 is ranked, its Fast tier is not.
    expect(arenaElo(m("bytedance/seedance-2.0"))).toBe(1138);
    expect(arenaElo(m("bytedance/seedance-2.0-fast"))).toBeUndefined();
  });

  it("does not mistake neighbouring versions", () => {
    expect(arenaElo(m("alibaba/wan-2.6"))).toBeUndefined();
    expect(arenaElo(m("fal-ai/wan/v2.2-a14b/text-to-video"))).toBeUndefined();
    expect(arenaElo(m("alibaba/wan-3.0"))).toBe(1173);
    expect(arenaElo(m("grok-imagine-video"))).toBeUndefined();
    expect(arenaElo(m("minimax/hailuo-2.3"))).toBeUndefined();
    expect(arenaElo(m("veo-3.10"))).toBeUndefined();
  });
});

describe("arenaEntry for image models", () => {
  it("matches Gemini, OpenRouter and fal spellings of Nano Banana", () => {
    expect(arenaEntry(still("gemini-3.1-flash-image-preview"))?.name).toBe(
      "Nano Banana 2",
    );
    expect(
      arenaEntry(
        still(
          "google/gemini-3.1-flash-image-preview",
          "Google: Nano Banana 2 (Gemini 3.1 Flash Image Preview)",
        ),
      )?.name,
    ).toBe("Nano Banana 2");
    expect(arenaEntry(still("fal-ai/nano-banana-2/edit"))?.name).toBe(
      "Nano Banana 2",
    );
    expect(arenaEntry(still("gemini-3.1-flash-lite-image"))?.name).toBe(
      "Nano Banana 2 Lite",
    );
    expect(arenaEntry(still("gemini-3-pro-image-preview"))?.name).toBe(
      "Nano Banana Pro",
    );
    expect(arenaEntry(still("fal-ai/nano-banana-pro"))?.name).toBe(
      "Nano Banana Pro",
    );
    expect(arenaEntry(still("gemini-nano-banana-2.1"))?.name).toBe(
      "Nano Banana 2.1",
    );
    expect(arenaEntry(still("fal-ai/nano-banana/edit"))?.name).toBe(
      "Nano Banana",
    );
  });

  it("keeps image tiers apart", () => {
    expect(arenaElo(still("grok-imagine-image"))).toBe(1022);
    expect(arenaElo(still("grok-imagine-image-quality"))).toBe(1049);
    expect(arenaElo(still("x-ai/grok-imagine-image-2.0"))).toBe(1166);
    expect(arenaElo(still("black-forest-labs/flux.2-pro"))).toBe(1003);
    expect(arenaElo(still("fal-ai/flux-2-flex"))).toBe(1026);
    expect(arenaElo(still("fal-ai/flux-2", "FLUX.2 [dev]"))).toBe(1000);
    expect(arenaElo(still("fal-ai/flux-2/turbo", "FLUX.2 [dev] Turbo"))).toBe(
      994,
    );
    expect(
      arenaElo(still("fal-ai/bytedance/seedream/v4.5/text-to-image")),
    ).toBe(1026);
    expect(arenaElo(still("bytedance-seed/seedream-5-0-pro"))).toBe(1100);
    expect(arenaElo(still("fal-ai/flux-pro/kontext/max"))).toBe(929);
    // Unlisted tiers and versions stay unranked.
    expect(arenaElo(still("fal-ai/flux-2/klein/9b"))).toBeUndefined();
    expect(arenaElo(still("fal-ai/qwen-image-2.0"))).toBeUndefined();
  });

  it("never scores a video model from the image arena, or back", () => {
    expect(arenaEntry(still("fal-ai/flux-3"))?.name).toBe("FLUX 3 Image");
    expect(arenaEntry(m("fal-ai/flux-3/max"))?.name).toBe("FLUX 3 Max");
    expect(arenaElo(m("grok-imagine-image"))).toBeUndefined();
    expect(arenaElo(still("google/veo-3.1"))).toBeUndefined();
  });
});

describe("rankModels", () => {
  it("puts the best first and keeps unranked models in their order", () => {
    const ranked = rankModels([
      m("unknown/b"),
      m("google/veo-3.1-lite", "Veo 3.1 Lite"),
      m("unknown/a"),
      m("alibaba/wan-3.0"),
    ]);
    expect(ranked.map((model) => model.id)).toEqual([
      "alibaba/wan-3.0",
      "google/veo-3.1-lite",
      "unknown/b",
      "unknown/a",
    ]);
  });
});
