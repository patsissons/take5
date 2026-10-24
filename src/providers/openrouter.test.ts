import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/openrouter-models.json";
import imageEndpoints from "./fixtures/openrouter-image-endpoints.json";
import imageFixture from "./fixtures/openrouter-image-models.json";
import imageResult from "./fixtures/openrouter-image-result.json";
import { ProviderError } from "./http";
import {
  buildBody,
  buildImageBody,
  imageAnswer,
  isGenerationModel,
  mapStatus,
  normalizeImageModel,
  normalizeModel,
  openrouter,
  pricingFromEndpoints,
  pricingFromSkus,
  type ImageEndpoints,
  type OpenRouterImageModel,
  type OpenRouterJob,
  type OpenRouterModel,
} from "./openrouter";
import type { JobEvent, JobRef, MediaRequest } from "./types";

const models = fixture.data as unknown as OpenRouterModel[];
const byId = (id: string) => models.find((model) => model.id === id)!;

/** Answers fetch calls in order, recording each request. */
function mockFetch(...responses: Array<Response | (() => Response)>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return typeof next === "function" ? next() : next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const job: JobRef = {
  provider: "openrouter",
  id: "gen-vid-1",
  model: "x",
  submittedAt: 0,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("normalizeModel", () => {
  it("maps capabilities and per-second cents pricing", () => {
    const model = normalizeModel(byId("x-ai/grok-imagine-video-1.5-lite"));
    expect(model).toMatchObject({
      provider: "openrouter",
      id: "x-ai/grok-imagine-video-1.5-lite",
      frameImages: ["first_frame"],
      audio: null,
      resolutions: ["480p", "720p", "1080p"],
      sizes: null,
    });
    expect(model.durations).toContain(5);
    expect(model.pricing).toEqual({
      kind: "per-second",
      rates: [
        { usdPerSecond: 0.02, resolution: "480p" },
        { usdPerSecond: 0.03, resolution: "720p" },
        { usdPerSecond: 0.14, resolution: "1080p" },
      ],
    });
  });

  it("maps USD-per-second SKUs with audio and modality conditions", () => {
    const veo = normalizeModel(byId("google/veo-3.1-lite"));
    expect(veo.audio).toBe(true);
    expect(veo.frameImages).toEqual(["first_frame", "last_frame"]);
    expect(veo.pricing).toMatchObject({ kind: "per-second" });
    const rates = (veo.pricing as { rates: unknown[] }).rates;
    expect(rates).toContainEqual({
      usdPerSecond: 0.05,
      resolution: "720p",
      audio: true,
    });
    const wan = normalizeModel(byId("alibaba/wan-2.6"));
    expect((wan.pricing as { rates: unknown[] }).rates).toContainEqual({
      usdPerSecond: 0.1,
      resolution: "720p",
      imageInput: true,
    });
  });

  it("notes token pricing instead of guessing", () => {
    expect(pricingFromSkus({ video_tokens: "0.0000042" })).toEqual({
      kind: "unknown",
      note: "Priced per video token",
    });
    expect(pricingFromSkus(null)).toBeNull();
    expect(pricingFromSkus({ generate: "0.5" })).toEqual({
      kind: "unknown",
      note: "See OpenRouter for pricing",
    });
  });

  it("filters out editors and upscalers", () => {
    expect(isGenerationModel(byId("black-forest-labs/flux-video-edit"))).toBe(
      false,
    );
    expect(isGenerationModel(byId("minimax/hailuo-2.3"))).toBe(true);
    expect(
      isGenerationModel({ ...byId("minimax/hailuo-2.3"), upscale_factor: {} }),
    ).toBe(false);
  });
});

describe("buildBody", () => {
  const base: MediaRequest = {
    model: "google/veo-3.1-lite",
    prompt: "a cat",
    duration: 4,
    resolution: "720p",
    aspectRatio: "16:9",
    audio: false,
    images: [],
  };

  it("sends the neutral request in OpenRouter's field names", () => {
    expect(buildBody(base)).toEqual({
      model: "google/veo-3.1-lite",
      prompt: "a cat",
      duration: 4,
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: false,
    });
  });

  it("prefers an exact size over resolution + ratio", () => {
    const body = buildBody({ ...base, size: "1280x720" });
    expect(body.size).toBe("1280x720");
    expect(body).not.toHaveProperty("resolution");
    expect(body).not.toHaveProperty("aspect_ratio");
  });

  it("sends frames inline and references separately", () => {
    const body = buildBody({
      ...base,
      images: [
        { role: "first_frame", dataUrl: "data:image/jpeg;base64,AAA" },
        { role: "reference", dataUrl: "data:image/jpeg;base64,BBB" },
      ],
    });
    expect(body.frame_images).toEqual([
      {
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64,AAA" },
        frame_type: "first_frame",
      },
    ]);
    expect(body.input_references).toEqual([
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,BBB" } },
    ]);
  });
});

describe("mapStatus", () => {
  it("collapses OpenRouter's states onto the timeline", () => {
    expect(mapStatus("pending")).toBe("queued");
    expect(mapStatus("in_progress")).toBe("running");
    expect(mapStatus("completed")).toBe("completed");
    expect(mapStatus("cancelled")).toBe("cancelled");
    expect(mapStatus("expired")).toBe("failed");
  });
});

describe("openrouter", () => {
  it("validates a key against /key", async () => {
    const calls = mockFetch(
      Response.json({ data: { label: "mine", limit_remaining: 4.5 } }),
    );
    await expect(openrouter.validateKey("sk-or-test")).resolves.toEqual({
      label: "mine",
      remainingUsd: 4.5,
    });
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/key");
    expect(calls[0]!.init?.headers).toEqual({
      authorization: "Bearer sk-or-test",
    });
  });

  it("surfaces a rejected key as an auth ProviderError", async () => {
    mockFetch(
      new Response(
        JSON.stringify({ error: { message: "No cookie", code: 401 } }),
        {
          status: 401,
        },
      ),
    );
    const error = await openrouter.validateKey("bad").catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.message).toBe("No cookie");
    expect(error.isAuth).toBe(true);
  });

  it("lists only generation models", async () => {
    mockFetch(Response.json(fixture));
    const list = await openrouter.listModels("k", "video");
    expect(list.map((model) => model.id)).not.toContain(
      "black-forest-labs/flux-video-edit",
    );
    expect(list).toHaveLength(models.length - 1);
  });

  it("submits and returns a job reference", async () => {
    const calls = mockFetch(
      Response.json(
        { id: "gen-vid-9", status: "pending", polling_url: "/x" },
        { status: 202 },
      ),
    );
    const ref = await openrouter.submit("k", {
      model: "m",
      prompt: "p",
      images: [],
    });
    expect(ref).toMatchObject({
      provider: "openrouter",
      id: "gen-vid-9",
      model: "m",
    });
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/videos");
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({
      model: "m",
      prompt: "p",
    });
  });

  it("polls until completion, emitting each status change once", async () => {
    vi.useFakeTimers();
    const state = (status: OpenRouterJob["status"], extra = {}) =>
      Response.json({ id: "gen-vid-1", status, ...extra });
    mockFetch(
      state("pending"),
      state("pending"),
      state("in_progress"),
      state("completed", {
        urls: ["https://cdn.example/v.mp4"],
        usage: { cost: 0.12 },
      }),
    );
    const events: JobEvent[] = [];
    const run = (async () => {
      for await (const event of openrouter.watch(
        "k",
        job,
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();
    await vi.advanceTimersByTimeAsync(3000 * 3 + 10);
    await run;
    expect(events.map((event) => event.kind)).toEqual([
      "status",
      "status",
      "completed",
    ]);
    expect(events[0]).toMatchObject({ status: "queued" });
    expect(events[1]).toMatchObject({ status: "running" });
    expect(events[2]).toMatchObject({
      result: { costUsd: 0.12, mediaUrl: "https://cdn.example/v.mp4" },
    });
  });

  it("reports a failed job with the provider's message", async () => {
    mockFetch(
      Response.json({ id: "gen-vid-1", status: "failed", error: "nsfw" }),
    );
    const events: JobEvent[] = [];
    for await (const event of openrouter.watch(
      "k",
      job,
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(events).toEqual([
      expect.objectContaining({ kind: "failed", error: "nsfw" }),
    ]);
  });

  it("stops polling when aborted", async () => {
    vi.useFakeTimers();
    mockFetch(Response.json({ id: "gen-vid-1", status: "pending" }));
    const controller = new AbortController();
    const events: JobEvent[] = [];
    const run = (async () => {
      try {
        for await (const event of openrouter.watch(
          "k",
          job,
          controller.signal,
        )) {
          events.push(event);
        }
      } catch (error) {
        return (error as Error).name;
      }
      return "finished";
    })();
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await expect(run).resolves.toBe("AbortError");
    expect(events).toHaveLength(1);
  });

  it("downloads the video through the authenticated content endpoint", async () => {
    const calls = mockFetch(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "video/mp4" },
      }),
    );
    const blob = await openrouter.fetchMedia("k", job, {});
    expect(blob.size).toBe(3);
    expect(calls[0]!.url).toBe(
      "https://openrouter.ai/api/v1/videos/gen-vid-1/content?index=0",
    );
    expect(calls[0]!.init?.headers).toEqual({ authorization: "Bearer k" });
  });
});

const imageModels = imageFixture.data as unknown as OpenRouterImageModel[];
const imageById = (id: string) => imageModels.find((m) => m.id === id)!;
const endpoints = imageEndpoints as unknown as Record<string, ImageEndpoints>;

describe("normalizeImageModel", () => {
  it("reads resolutions, aspect ratios and how many references it takes", () => {
    expect(
      normalizeImageModel(imageById("qwen/qwen-image-2.1-turbo")),
    ).toMatchObject({
      kind: "image",
      frameImages: [],
      referenceImages: true,
      maxImages: 4,
      resolutions: ["1K", "2K"],
      aspectRatios: expect.arrayContaining(["1:1", "16:9"]),
      durations: null,
      audio: null,
    });
  });

  it("marks edit-only models and models that take no image", () => {
    expect(normalizeImageModel(imageById("krea/k3-edit"))).toMatchObject({
      imageRequired: true,
      maxImages: 8,
    });
    const flash = normalizeImageModel(imageById("recraft/recraft-v4.1-flash"));
    expect(flash.referenceImages).toBe(false);
    expect(flash.maxImages).toBeUndefined();
    expect(flash.resolutions).toBeNull();
    // No parameters listed at all: nothing to send but the prompt.
    expect(normalizeImageModel(imageById("meta/muse-image"))).toMatchObject({
      referenceImages: false,
      aspectRatios: null,
    });
  });
});

describe("pricingFromEndpoints", () => {
  it("keeps the cheapest output price per resolution", () => {
    expect(
      pricingFromEndpoints(endpoints["x-ai/grok-imagine-image-2.0"]),
    ).toEqual({
      kind: "per-image",
      rates: [
        { usd: 0.04, resolution: "1K" },
        { usd: 0.06, resolution: "2K" },
      ],
    });
    expect(
      pricingFromEndpoints(endpoints["recraft/recraft-v4.1-flash"]),
    ).toEqual({ kind: "per-image", rates: [{ usd: 0.007 }] });
  });

  it("reads megapixel and token prices, and no price at all", () => {
    expect(
      pricingFromEndpoints(endpoints["black-forest-labs/flux.2-pro"]),
    ).toEqual({ kind: "per-megapixel", usd: 0.03 });
    expect(pricingFromEndpoints(endpoints["openai/gpt-image-2"])).toEqual({
      kind: "unknown",
      note: "Priced per image token",
    });
    expect(pricingFromEndpoints(endpoints["krea/k3-edit"])).toBeNull();
    expect(pricingFromEndpoints(undefined)).toBeNull();
  });
});

describe("buildImageBody", () => {
  it("sends the prompt, shape and references", () => {
    expect(
      buildImageBody({
        kind: "image",
        model: "m",
        prompt: "p",
        resolution: "2K",
        aspectRatio: "1:1",
        images: [{ role: "reference", dataUrl: "data:image/png;base64,AA" }],
      }),
    ).toEqual({
      model: "m",
      prompt: "p",
      resolution: "2K",
      aspect_ratio: "1:1",
      input_references: [
        { type: "image_url", image_url: { url: "data:image/png;base64,AA" } },
      ],
    });
  });
});

describe("imageAnswer", () => {
  it("decodes the image and reports the cost", () => {
    const answer = imageAnswer(imageResult);
    expect(answer.kind).toBe("completed");
    if (answer.kind !== "completed") return;
    expect(answer.result.costUsd).toBe(0.04);
    expect(answer.result.media?.type).toBe("image/png");
    expect(answer.result.media?.size).toBe(70);
  });

  it("keeps a real image's base64 out of the raw event", () => {
    const big = "A".repeat(4000);
    const answer = imageAnswer({
      ...imageResult,
      data: [{ b64_json: big, media_type: "image/png" }],
    });
    expect(answer.kind === "completed" && answer.result.media?.size).toBe(3000);
    expect(JSON.stringify(answer.raw)).not.toContain(big);
  });

  it("fails when no image came back", () => {
    expect(imageAnswer({ data: [] })).toMatchObject({
      kind: "failed",
      error: "No image in the result",
    });
  });
});

describe("openrouter images", () => {
  it("lists image models with their prices; a missing price leaves one unpriced", async () => {
    const calls = mockFetch(
      Response.json(imageFixture),
      ...imageModels.map((model) =>
        endpoints[model.id]
          ? Response.json(endpoints[model.id])
          : Response.json({ error: { message: "nope" } }, { status: 404 }),
      ),
    );
    const list = await openrouter.listModels("k", "image");
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/images/models");
    expect(calls.slice(1).map((call) => call.url)).toContain(
      "https://openrouter.ai/api/v1/images/models/x-ai/grok-imagine-image-2.0/endpoints",
    );
    expect(list).toHaveLength(imageModels.length);
    expect(list.every((model) => model.kind === "image")).toBe(true);
    const priced = Object.fromEntries(list.map((m) => [m.id, m.pricing]));
    expect(priced["black-forest-labs/flux.2-pro"]).toEqual({
      kind: "per-megapixel",
      usd: 0.03,
    });
    expect(priced["meta/muse-image"]).toBeNull();
  });

  it("answers an image request at submit", async () => {
    const calls = mockFetch(Response.json(imageResult));
    const ref = await openrouter.submit("k", {
      kind: "image",
      model: "x-ai/grok-imagine-image-2.0",
      prompt: "a fox",
      resolution: "1K",
      images: [],
    });
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/images");
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({
      model: "x-ai/grok-imagine-image-2.0",
      prompt: "a fox",
      resolution: "1K",
    });
    expect(ref.answer).toMatchObject({
      kind: "completed",
      result: { costUsd: 0.04 },
    });
  });

  it("passes a failed generation on as an error", async () => {
    mockFetch(
      Response.json(
        { error: { message: "Generation failed", code: 502 } },
        { status: 502 },
      ),
    );
    const error = await openrouter
      .submit("k", { kind: "image", model: "m", prompt: "p", images: [] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toBe("Generation failed");
  });
});
