import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobEvent, JobRef } from "./types";
import { buildBody, KNOWN_MODELS, modelIds, normalizeModel, xai } from "./xai";

function mockFetch(...responses: Response[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error(`unexpected fetch ${url}`);
      return next;
    }),
  );
  return calls;
}

const job: JobRef = {
  provider: "xai",
  id: "req-1",
  model: "grok-imagine-video-1.5-lite",
  submittedAt: 0,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("normalizeModel / modelIds", () => {
  it("knows the documented models' capabilities and prices", () => {
    const lite = normalizeModel("grok-imagine-video-1.5-lite");
    expect(lite).toMatchObject({
      name: "Grok Imagine Video 1.5 Lite",
      frameImages: ["first_frame", "last_frame"],
      resolutions: ["480p", "720p", "1080p"],
      audio: true,
      pricing: { kind: "per-second", rates: [{ usdPerSecond: 0.02 }] },
    });
    expect(lite.durations).toHaveLength(15);
    expect(normalizeModel("grok-imagine-video").frameImages).toEqual([
      "first_frame",
    ]);
    expect(normalizeModel("grok-imagine-video-9").pricing).toBeNull();
  });

  it("reads ids from any of the likely payload shapes", () => {
    expect(
      modelIds({ models: [{ id: "grok-imagine-video" }, { id: "grok-4" }] }),
    ).toEqual(["grok-imagine-video"]);
    expect(modelIds({ data: ["grok-imagine-video-1.5"] })).toEqual([
      "grok-imagine-video-1.5",
    ]);
    expect(modelIds([{ name: "grok-imagine-video-1.5-lite" }])).toEqual([
      "grok-imagine-video-1.5-lite",
    ]);
    expect(modelIds(null)).toEqual([]);
  });
});

describe("buildBody", () => {
  it("maps the request", () => {
    expect(
      buildBody({
        model: "grok-imagine-video-1.5",
        prompt: "p",
        duration: 5,
        aspectRatio: "16:9",
        resolution: "720p",
        audio: false,
        images: [
          { role: "first_frame", dataUrl: "data:A" },
          { role: "last_frame", dataUrl: "data:B" },
          { role: "reference", dataUrl: "data:C" },
        ],
      }),
    ).toEqual({
      model: "grok-imagine-video-1.5",
      prompt: "p",
      duration: 5,
      aspect_ratio: "16:9",
      resolution: "720p",
      generate_audio: false,
      image: { url: "data:A" },
      last_frame: { url: "data:B" },
      reference_images: [{ url: "data:C" }],
    });
  });
});

describe("xai", () => {
  it("validates the key and reads its name", async () => {
    const calls = mockFetch(Response.json({ name: "my key" }));
    await expect(xai.validateKey("xai-1")).resolves.toEqual({
      label: "my key",
    });
    expect(calls[0]!.url).toBe("https://api.x.ai/v1/api-key");
    expect(calls[0]!.init?.headers).toEqual({ authorization: "Bearer xai-1" });
  });

  it("lists models from the endpoint, or the documented set when it is unavailable", async () => {
    mockFetch(Response.json({ models: [{ id: "grok-imagine-video-1.5" }] }));
    expect((await xai.listModels("k")).map((m) => m.id)).toEqual([
      "grok-imagine-video-1.5",
    ]);

    mockFetch(new Response("gone", { status: 404 }));
    expect((await xai.listModels("k")).map((m) => m.id)).toEqual(
      KNOWN_MODELS.map((m) => m.id),
    );

    mockFetch(new Response("bad key", { status: 401 }));
    await expect(xai.listModels("k")).rejects.toThrow("bad key");
  });

  it("submits and polls to a video URL", async () => {
    vi.useFakeTimers();
    mockFetch(
      Response.json({ request_id: "req-1" }),
      Response.json({ status: "pending" }),
      Response.json({
        status: "done",
        video: { url: "https://vidgen.x.ai/v.mp4", duration: 5 },
      }),
    );
    const ref = await xai.submit("k", {
      model: job.model,
      prompt: "p",
      images: [],
    });
    expect(ref.id).toBe("req-1");
    const events: JobEvent[] = [];
    const run = (async () => {
      for await (const event of xai.watch(
        "k",
        ref,
        new AbortController().signal,
      ))
        events.push(event);
    })();
    await vi.advanceTimersByTimeAsync(5500);
    await run;
    expect(events).toEqual([
      expect.objectContaining({ kind: "status", status: "queued" }),
      expect.objectContaining({
        kind: "completed",
        result: { videoUrl: "https://vidgen.x.ai/v.mp4" },
      }),
    ]);
  });

  it("reports failures with the provider's message", async () => {
    mockFetch(
      Response.json({
        status: "failed",
        error: { code: "invalid_argument", message: "Prompt cannot be empty" },
      }),
    );
    const events: JobEvent[] = [];
    for await (const event of xai.watch("k", job, new AbortController().signal))
      events.push(event);
    expect(events).toEqual([
      expect.objectContaining({
        kind: "failed",
        error: "Prompt cannot be empty",
      }),
    ]);
  });
});
