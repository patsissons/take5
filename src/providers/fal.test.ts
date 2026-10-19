import { afterEach, describe, expect, it, vi } from "vitest";
import hailuo from "./fixtures/fal-openapi-hailuo.json";
import kling from "./fixtures/fal-openapi-kling.json";
import wan from "./fixtures/fal-openapi-wan.json";
import list from "./fixtures/fal-models.json";
import {
  applySchema,
  buildBody,
  fal,
  inputSchema,
  isUsable,
  normalizeModel,
  pricingFromPrices,
  type FalModel,
  type JsonSchema,
} from "./fal";
import type { JobEvent, JobRef } from "./types";

const schemasOf = (doc: unknown) =>
  (
    doc as {
      models: Array<{
        openapi: { components: { schemas: Record<string, JsonSchema> } };
      }>;
    }
  ).models[0]!.openapi.components.schemas;

function mockFetch(
  ...responses: Array<Response | ((url: string) => Response)>
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error(`unexpected fetch ${url}`);
      return typeof next === "function" ? next(url) : next;
    }),
  );
  return calls;
}

function stream(events: unknown[]): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

const job: JobRef = {
  provider: "fal",
  id: "req-1",
  model: "fal-ai/kling-video/v3/pro/image-to-video",
  submittedAt: 0,
  extra: {
    statusUrl: "https://queue.fal.run/fal-ai/kling-video/requests/req-1/status",
    responseUrl: "https://queue.fal.run/fal-ai/kling-video/requests/req-1",
    cancelUrl: "https://queue.fal.run/fal-ai/kling-video/requests/req-1/cancel",
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("normalizeModel / isUsable", () => {
  it("keeps active inference endpoints and marks image-to-video", () => {
    const models = (list.models as FalModel[])
      .filter(isUsable)
      .map(normalizeModel);
    expect(models.map((m) => m.id)).not.toContain("fal-ai/old-model");
    const kling = models.find((m) => m.id.includes("kling"))!;
    expect(kling).toMatchObject({
      provider: "fal",
      name: "Kling Video v3 Image to Video [Pro]",
      frameImages: ["first_frame"],
      durations: null,
      extra: { category: "image-to-video" },
    });
    expect(models.find((m) => m.id.includes("hailuo"))!.frameImages).toEqual(
      [],
    );
  });
});

describe("inputSchema / applySchema", () => {
  const base = normalizeModel((list.models as FalModel[])[1]!);

  it("reads frames, durations, audio and the field names from Kling's schema", () => {
    const input = inputSchema(schemasOf(kling))!;
    expect(input.properties).toHaveProperty("start_image_url");
    const model = applySchema(base, input);
    expect(model.frameImages).toEqual(["first_frame", "last_frame"]);
    expect(model.durations).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    expect(model.audio).toBe(true);
    expect(model.resolutions).toBeNull();
    expect(model.extra).toMatchObject({
      firstFrameField: "start_image_url",
      lastFrameField: "end_image_url",
      durationType: "string",
      audioField: "generate_audio",
    });
  });

  it("reads resolutions and ratios from Wan's schema and string durations from Hailuo's", () => {
    const wanModel = applySchema(base, inputSchema(schemasOf(wan))!);
    expect(wanModel.resolutions).toEqual(["480p", "580p", "720p"]);
    expect(wanModel.aspectRatios).toEqual(["16:9", "9:16", "1:1"]);
    expect(wanModel.frameImages).toEqual([]);
    expect(wanModel.durations).toBeNull();
    const hailuoModel = applySchema(base, inputSchema(schemasOf(hailuo))!);
    expect(hailuoModel.durations).toEqual([6, 10]);
    expect(hailuoModel.audio).toBeNull();
  });
});

describe("pricingFromPrices", () => {
  it("maps units", () => {
    expect(
      pricingFromPrices([
        {
          endpoint_id: "x",
          unit_price: 0.1,
          unit: "video_second",
          currency: "USD",
        },
      ]),
    ).toEqual({ kind: "per-second", rates: [{ usdPerSecond: 0.1 }] });
    expect(
      pricingFromPrices([
        { endpoint_id: "x", unit_price: 1, unit: "video", currency: "USD" },
      ]),
    ).toEqual({ kind: "per-video", usd: 1 });
    expect(
      pricingFromPrices([
        { endpoint_id: "x", unit_price: 2, unit: "megapixel", currency: "USD" },
      ]),
    ).toEqual({ kind: "unknown", note: "2 USD per megapixel" });
    expect(pricingFromPrices([])).toBeNull();
  });
});

describe("buildBody", () => {
  it("uses the schema's field names and types", () => {
    expect(
      buildBody(
        {
          model: "m",
          prompt: "p",
          duration: 5,
          resolution: "720p",
          aspectRatio: "16:9",
          audio: false,
          images: [
            { role: "first_frame", dataUrl: "data:image/jpeg;base64,A" },
            { role: "last_frame", dataUrl: "data:image/jpeg;base64,B" },
            { role: "reference", dataUrl: "data:image/jpeg;base64,C" },
          ],
        },
        {
          firstFrameField: "start_image_url",
          lastFrameField: "end_image_url",
          durationType: "string",
          audioField: "generate_audio",
        },
      ),
    ).toEqual({
      prompt: "p",
      duration: "5",
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: false,
      start_image_url: "data:image/jpeg;base64,A",
      end_image_url: "data:image/jpeg;base64,B",
      reference_image_urls: ["data:image/jpeg;base64,C"],
    });
  });

  it("falls back to image_url and a numeric duration", () => {
    expect(
      buildBody({
        model: "m",
        prompt: "p",
        duration: 5,
        audio: true,
        images: [{ role: "first_frame", dataUrl: "d" }],
      }),
    ).toEqual({ prompt: "p", duration: 5, image_url: "d" });
  });
});

describe("fal", () => {
  it("validates the key with an authenticated pricing call", async () => {
    const calls = mockFetch(Response.json({ prices: [] }));
    await fal.validateKey("id:secret");
    expect(calls[0]!.url).toContain("/v1/models/pricing?endpoint_id=");
    expect(calls[0]!.init?.headers).toEqual({ authorization: "Key id:secret" });
  });

  it("pages through both video categories", async () => {
    const calls = mockFetch(
      Response.json({
        models: list.models.slice(0, 2),
        next_cursor: "c2",
        has_more: true,
      }),
      Response.json({
        models: list.models.slice(2),
        next_cursor: null,
        has_more: false,
      }),
      Response.json({
        models: [list.models[1]],
        next_cursor: null,
        has_more: false,
      }),
    );
    const models = await fal.listModels("k");
    expect(
      calls.map((c) => new URL(c.url).searchParams.get("category")),
    ).toEqual(["text-to-video", "text-to-video", "image-to-video"]);
    expect(calls[1]!.url).toContain("cursor=c2");
    expect(models).toHaveLength(4);
  });

  it("inspects a model from its OpenAPI schema and price", async () => {
    mockFetch(
      (url) =>
        url.includes("pricing")
          ? Response.json({
              prices: [
                {
                  endpoint_id: "x",
                  unit_price: 0.07,
                  unit: "video_second",
                  currency: "USD",
                },
              ],
            })
          : Response.json(kling),
      (url) =>
        url.includes("pricing")
          ? Response.json({
              prices: [
                {
                  endpoint_id: "x",
                  unit_price: 0.07,
                  unit: "video_second",
                  currency: "USD",
                },
              ],
            })
          : Response.json(kling),
    );
    const model = await fal.inspectModel!(
      "k",
      normalizeModel((list.models as FalModel[])[1]!),
    );
    expect(model.frameImages).toEqual(["first_frame", "last_frame"]);
    expect(model.pricing).toEqual({
      kind: "per-second",
      rates: [{ usdPerSecond: 0.07 }],
    });
  });

  it("submits to the queue and keeps the returned URLs", async () => {
    const calls = mockFetch(
      Response.json({
        request_id: "req-1",
        status_url:
          "https://queue.fal.run/fal-ai/kling-video/requests/req-1/status",
        response_url: "https://queue.fal.run/fal-ai/kling-video/requests/req-1",
        cancel_url:
          "https://queue.fal.run/fal-ai/kling-video/requests/req-1/cancel",
      }),
    );
    const ref = await fal.submit("k", {
      model: "fal-ai/kling-video/v3/pro/image-to-video",
      prompt: "p",
      images: [],
      extra: { durationType: "string" },
    });
    expect(calls[0]!.url).toBe(
      "https://queue.fal.run/fal-ai/kling-video/v3/pro/image-to-video",
    );
    expect(ref.extra).toEqual(job.extra);
  });

  it("streams queue position and logs, then fetches the result", async () => {
    mockFetch(
      stream([
        { status: "IN_QUEUE", request_id: "req-1", queue_position: 2 },
        { status: "IN_QUEUE", request_id: "req-1", queue_position: 0 },
        {
          status: "IN_PROGRESS",
          request_id: "req-1",
          logs: [{ message: "warming up" }],
        },
        {
          status: "COMPLETED",
          request_id: "req-1",
          logs: [{ message: "warming up" }, { message: "done" }],
        },
      ]),
      Response.json({ video: { url: "https://v3.fal.media/files/v.mp4" } }),
    );
    const events: JobEvent[] = [];
    for await (const event of fal.watch(
      "k",
      job,
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(
      events.map((e) =>
        e.kind === "status" ? `${e.status}:${e.queuePosition}` : e.kind,
      ),
    ).toEqual([
      "queued:2",
      "queued:0",
      "log",
      "running:undefined",
      "log",
      "completed",
    ]);
    expect(events.at(-1)).toMatchObject({
      result: { videoUrl: "https://v3.fal.media/files/v.mp4" },
    });
  });

  it("falls back to polling when the stream cannot be opened", async () => {
    vi.useFakeTimers();
    mockFetch(
      new Response("nope", { status: 500 }),
      Response.json({ status: "IN_PROGRESS", request_id: "req-1" }),
      Response.json({
        status: "COMPLETED",
        request_id: "req-1",
        error: "boom",
        error_type: "x",
      }),
    );
    const events: JobEvent[] = [];
    const run = (async () => {
      for await (const event of fal.watch(
        "k",
        job,
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();
    await vi.advanceTimersByTimeAsync(3500);
    await run;
    expect(events).toEqual([
      expect.objectContaining({ kind: "status", status: "running" }),
      expect.objectContaining({ kind: "failed", error: "boom" }),
    ]);
  });

  it("downloads from the media CDN and cancels with PUT", async () => {
    const calls = mockFetch(
      new Response("bytes"),
      new Response("", { status: 202 }),
    );
    const blob = await fal.fetchVideo("k", job, {
      videoUrl: "https://v3.fal.media/v.mp4",
    });
    expect(blob.size).toBe(5);
    expect(calls[0]!.init?.headers).toBeUndefined();
    await fal.cancel!("k", job);
    expect(calls[1]).toMatchObject({
      url: job.extra!.cancelUrl,
      init: { method: "PUT", headers: { authorization: "Key k" } },
    });
  });
});
