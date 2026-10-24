import { afterEach, describe, expect, it, vi } from "vitest";
import blocked from "./fixtures/gemini-image-blocked.json";
import imageModels from "./fixtures/gemini-image-models.json";
import imageResponse from "./fixtures/gemini-image-response.json";
import {
  buildBody,
  buildImageBody,
  gemini,
  imageAnswer,
  imagePricingFor,
  isImageModel,
  isVideoModel,
  normalizeImageModel,
  normalizeModel,
  pricingFor,
} from "./gemini";
import type { JobEvent, JobRef } from "./types";

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
  provider: "gemini",
  id: "models/veo-3.1-lite-generate-preview/operations/op-1",
  model: "veo-3.1-lite-generate-preview",
  submittedAt: 0,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("normalizeModel", () => {
  it("keeps only Veo models with predictLongRunning", () => {
    expect(
      isVideoModel({
        name: "models/veo-3.1-generate-preview",
        supportedGenerationMethods: ["predictLongRunning"],
      }),
    ).toBe(true);
    expect(
      isVideoModel({
        name: "models/gemini-2.5-pro",
        supportedGenerationMethods: ["generateContent"],
      }),
    ).toBe(false);
  });

  it("derives capabilities and prices from the model id", () => {
    const lite = normalizeModel({
      name: "models/veo-3.1-lite-generate-preview",
      displayName: "Veo 3.1 Lite",
      supportedGenerationMethods: ["predictLongRunning"],
    });
    expect(lite).toMatchObject({
      id: "veo-3.1-lite-generate-preview",
      name: "Veo 3.1 Lite",
      durations: [4, 6, 8],
      resolutions: ["720p", "1080p"],
      referenceImages: false,
      audio: null,
    });
    expect(lite.pricing).toEqual({
      kind: "per-second",
      rates: [
        { resolution: "720p", usdPerSecond: 0.05 },
        { resolution: "1080p", usdPerSecond: 0.08 },
      ],
    });
    expect(
      normalizeModel({ name: "models/veo-3.1-generate-preview" }).resolutions,
    ).toEqual(["720p", "1080p", "4k"]);
    expect(pricingFor("veo-2.0-generate-001")).toBeNull();
  });
});

describe("buildBody", () => {
  it("inlines images and maps the parameters", () => {
    expect(
      buildBody({
        model: "m",
        prompt: "p",
        duration: 6,
        resolution: "720p",
        aspectRatio: "9:16",
        images: [
          { role: "first_frame", dataUrl: "data:image/png;base64,AAA" },
          { role: "last_frame", dataUrl: "data:image/jpeg;base64,BBB" },
          { role: "reference", dataUrl: "data:image/jpeg;base64,CCC" },
        ],
      }),
    ).toEqual({
      instances: [
        {
          prompt: "p",
          image: { inlineData: { mimeType: "image/png", data: "AAA" } },
          lastFrame: { inlineData: { mimeType: "image/jpeg", data: "BBB" } },
          referenceImages: [
            {
              image: { inlineData: { mimeType: "image/jpeg", data: "CCC" } },
              referenceType: "asset",
            },
          ],
        },
      ],
      parameters: {
        aspectRatio: "9:16",
        resolution: "720p",
        durationSeconds: 6,
      },
    });
  });
});

describe("gemini", () => {
  it("lists Veo models with the key header", async () => {
    const calls = mockFetch(
      Response.json({
        models: [
          {
            name: "models/gemini-2.5-pro",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/veo-3.1-fast-generate-preview",
            supportedGenerationMethods: ["predictLongRunning"],
          },
        ],
      }),
    );
    const models = await gemini.listModels("AIza", "video");
    expect(models.map((m) => m.id)).toEqual(["veo-3.1-fast-generate-preview"]);
    expect(calls[0]!.init?.headers).toEqual({ "x-goog-api-key": "AIza" });
  });

  it("submits a long-running prediction", async () => {
    const calls = mockFetch(Response.json({ name: job.id }));
    const ref = await gemini.submit("AIza", {
      model: job.model,
      prompt: "p",
      images: [],
    });
    expect(calls[0]!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-lite-generate-preview:predictLongRunning",
    );
    expect(ref.id).toBe(job.id);
  });

  it("polls the operation until it is done", async () => {
    vi.useFakeTimers();
    mockFetch(
      Response.json({ name: job.id, done: false }),
      Response.json({
        name: job.id,
        done: true,
        response: {
          generateVideoResponse: {
            generatedSamples: [
              {
                video: {
                  uri: "https://generativelanguage.googleapis.com/v1beta/files/f:download?alt=media",
                },
              },
            ],
          },
        },
      }),
    );
    const events: JobEvent[] = [];
    const run = (async () => {
      for await (const event of gemini.watch(
        "AIza",
        job,
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();
    await vi.advanceTimersByTimeAsync(5500);
    await run;
    expect(events).toEqual([
      expect.objectContaining({ kind: "status", status: "running" }),
      expect.objectContaining({
        kind: "completed",
        result: {
          mediaUrl:
            "https://generativelanguage.googleapis.com/v1beta/files/f:download?alt=media",
        },
      }),
    ]);
  });

  it("reports filtered output as a failure", async () => {
    mockFetch(
      Response.json({
        name: job.id,
        done: true,
        response: {
          generateVideoResponse: {
            raiMediaFilteredCount: 1,
            raiMediaFilteredReasons: ["Unsafe"],
          },
        },
      }),
    );
    const events: JobEvent[] = [];
    for await (const event of gemini.watch(
      "AIza",
      job,
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(events).toEqual([
      expect.objectContaining({ kind: "failed", error: "Unsafe" }),
    ]);
  });

  it("downloads with the key header", async () => {
    const calls = mockFetch(new Response("mp4"));
    await gemini.fetchMedia("AIza", job, {
      mediaUrl: "https://generativelanguage.googleapis.com/x",
    });
    expect(calls[0]!.init?.headers).toEqual({ "x-goog-api-key": "AIza" });
  });
});

describe("gemini images", () => {
  it("lists generateContent image models, not Imagen or Veo", async () => {
    mockFetch(Response.json(imageModels));
    const models = await gemini.listModels("AIza", "image");
    expect(models.map((m) => m.id)).toEqual([
      "gemini-nano-banana-2.1",
      "gemini-3.1-flash-image",
      "gemini-3.1-flash-lite-image",
      "gemini-3-pro-image",
    ]);
    expect(
      isImageModel({
        name: "models/imagen-4.0-generate-001",
        supportedGenerationMethods: ["generateContent"],
      }),
    ).toBe(false);
  });

  it("knows each model's sizes and per-image prices", () => {
    const flash = normalizeImageModel({
      name: "models/gemini-3.1-flash-image",
      displayName: "Nano Banana 2",
    });
    expect(flash).toMatchObject({
      kind: "image",
      name: "Nano Banana 2",
      referenceImages: true,
      maxImages: 14,
      resolutions: ["512", "1K", "2K", "4K"],
    });
    expect(flash.pricing).toEqual({
      kind: "per-image",
      rates: [
        { resolution: "512", usd: 0.045 },
        { resolution: "1K", usd: 0.067 },
        { resolution: "2K", usd: 0.101 },
        { resolution: "4K", usd: 0.151 },
      ],
    });
    expect(
      normalizeImageModel({ name: "models/gemini-3.1-flash-lite-image" })
        .resolutions,
    ).toBeNull();
    expect(imagePricingFor("gemini-3-pro-image-preview")).toMatchObject({
      rates: expect.arrayContaining([{ resolution: "4K", usd: 0.24 }]),
    });
    expect(imagePricingFor("gemini-9-image")).toBeNull();
  });

  it("asks for an image only, with references before the prompt", () => {
    expect(
      buildImageBody({
        kind: "image",
        model: "m",
        prompt: "a fox",
        aspectRatio: "1:1",
        resolution: "2K",
        images: [{ role: "reference", dataUrl: "data:image/png;base64,AA" }],
      }),
    ).toEqual({
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/png", data: "AA" } },
            { text: "a fox" },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "1:1", imageSize: "2K" },
      },
    });
    expect(
      buildImageBody({ kind: "image", model: "m", prompt: "p", images: [] })
        .generationConfig,
    ).toEqual({ responseModalities: ["IMAGE"] });
  });

  it("takes the final image, skipping thoughts", async () => {
    const answer = imageAnswer(imageResponse);
    expect(answer.kind).toBe("completed");
    if (answer.kind !== "completed") return;
    expect(answer.result.media?.type).toBe("image/png");
    expect(answer.result.media?.size).toBe(70);
    expect(answer.result.costUsd).toBeUndefined();
  });

  it("explains a refusal", () => {
    expect(imageAnswer(blocked)).toMatchObject({
      kind: "failed",
      error: "IMAGE_SAFETY",
    });
    expect(
      imageAnswer({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }),
    ).toMatchObject({ error: "PROHIBITED_CONTENT" });
    expect(
      imageAnswer({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: "I can only describe that." }] },
          },
        ],
      }),
    ).toMatchObject({ error: "I can only describe that." });
  });

  it("answers an image request at submit", async () => {
    const calls = mockFetch(Response.json(imageResponse));
    const ref = await gemini.submit("AIza", {
      kind: "image",
      model: "gemini-3.1-flash-image",
      prompt: "a fox",
      images: [],
    });
    expect(calls[0]!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent",
    );
    expect(calls[0]!.init?.headers).toMatchObject({ "x-goog-api-key": "AIza" });
    expect(ref.answer?.kind).toBe("completed");
  });
});
