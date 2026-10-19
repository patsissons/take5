import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBody,
  gemini,
  isVideoModel,
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
    const models = await gemini.listModels("AIza");
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
          videoUrl:
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
    await gemini.fetchVideo("AIza", job, {
      videoUrl: "https://generativelanguage.googleapis.com/x",
    });
    expect(calls[0]!.init?.headers).toEqual({ "x-goog-api-key": "AIza" });
  });
});
