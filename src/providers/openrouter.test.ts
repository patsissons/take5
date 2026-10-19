import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/openrouter-models.json";
import { ProviderError } from "./http";
import {
  buildBody,
  isGenerationModel,
  mapStatus,
  normalizeModel,
  openrouter,
  pricingFromSkus,
  type OpenRouterJob,
  type OpenRouterModel,
} from "./openrouter";
import type { JobEvent, JobRef, VideoRequest } from "./types";

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
  const base: VideoRequest = {
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
    const list = await openrouter.listModels("k");
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
      result: { costUsd: 0.12, videoUrl: "https://cdn.example/v.mp4" },
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
    const blob = await openrouter.fetchVideo("k", job, {});
    expect(blob.size).toBe(3);
    expect(calls[0]!.url).toBe(
      "https://openrouter.ai/api/v1/videos/gen-vid-1/content?index=0",
    );
    expect(calls[0]!.init?.headers).toEqual({ authorization: "Bearer k" });
  });
});
