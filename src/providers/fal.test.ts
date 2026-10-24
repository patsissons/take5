import { afterEach, describe, expect, it, vi } from "vitest";
import hailuo from "./fixtures/fal-openapi-hailuo.json";
import kling from "./fixtures/fal-openapi-kling.json";
import wan from "./fixtures/fal-openapi-wan.json";
import list from "./fixtures/fal-models.json";
import prices from "./fixtures/fal-pricing.json";
import imageList from "./fixtures/fal-image-models.json";
// Hand-written: the pricing endpoint needs a key to record.
import imagePrices from "./fixtures/fal-image-pricing.json";
import flux2Pro from "./fixtures/fal-openapi-flux-2-pro.json";
import kontext from "./fixtures/fal-openapi-kontext.json";
import nanoBananaEdit from "./fixtures/fal-openapi-nano-banana-edit.json";
import {
  applySchema,
  buildBody,
  fal,
  inputSchema,
  isUsable,
  normalizeModel,
  listPrices,
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
      Response.json(prices),
    );
    const models = await fal.listModels("k", "video");
    expect(
      calls.slice(0, 3).map((c) => new URL(c.url).searchParams.get("category")),
    ).toEqual(["text-to-video", "text-to-video", "image-to-video"]);
    expect(calls[1]!.url).toContain("cursor=c2");
    expect(models).toHaveLength(4);

    // One authenticated pricing call for every listed endpoint.
    const pricing = new URL(calls[3]!.url);
    expect(pricing.pathname).toBe("/v1/models/pricing");
    expect(pricing.searchParams.get("endpoint_id")!.split(",")).toEqual(
      models.map((model) => model.id),
    );
    expect(calls[3]!.init?.headers).toEqual({ authorization: "Key k" });
    expect(Object.fromEntries(models.map((m) => [m.id, m.pricing]))).toEqual({
      "fal-ai/minimax/hailuo-02/standard/text-to-video": {
        kind: "per-second",
        rates: [{ usdPerSecond: 0.045 }],
      },
      "fal-ai/kling-video/v3/pro/image-to-video": {
        kind: "per-second",
        rates: [{ usdPerSecond: 0.07 }],
      },
      "fal-ai/wan/v2.2-a14b/text-to-video": { kind: "per-video", usd: 0.4 },
      "minimax/h3-max/text-to-video": null,
    });
  });

  it("asks for prices fifty endpoints at a time and survives a failed chunk", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `fal-ai/m${i}`);
    const calls = mockFetch(
      Response.json({
        prices: [
          {
            endpoint_id: "fal-ai/m0",
            unit_price: 0.1,
            unit: "video_second",
            currency: "USD",
          },
        ],
      }),
      new Response("down", { status: 500 }),
      Response.json({
        prices: [
          {
            endpoint_id: "fal-ai/m119",
            unit_price: 1,
            unit: "video",
            currency: "USD",
          },
        ],
      }),
    );
    const byId = await listPrices("k", ids);
    expect(
      calls.map(
        (c) =>
          new URL(c.url).searchParams.get("endpoint_id")!.split(",").length,
      ),
    ).toEqual([50, 50, 20]);
    expect([...byId.keys()]).toEqual(["fal-ai/m0", "fal-ai/m119"]);
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
      result: { mediaUrl: "https://v3.fal.media/files/v.mp4" },
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
    const blob = await fal.fetchMedia("k", job, {
      mediaUrl: "https://v3.fal.media/v.mp4",
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

describe("fal images", () => {
  const images = (imageList.models as FalModel[]).filter(isUsable);
  const byId = (id: string) =>
    normalizeModel(images.find((m) => m.endpoint_id === id)!);

  it("lists text-to-image and editors, but not tools that take no prompt", () => {
    expect(images.map((m) => m.endpoint_id)).not.toContain("fal-ai/esrgan");
    expect(byId("fal-ai/nano-banana-2")).toMatchObject({
      kind: "image",
      frameImages: [],
      referenceImages: false,
    });
    expect(byId("fal-ai/nano-banana-2/edit")).toMatchObject({
      kind: "image",
      referenceImages: true,
    });
  });

  it("reads a list of references and resolutions from Nano Banana's edit schema", () => {
    const model = applySchema(
      byId("fal-ai/nano-banana-2/edit"),
      inputSchema(schemasOf(nanoBananaEdit))!,
    );
    expect(model).toMatchObject({
      referenceImages: true,
      imageRequired: false,
      resolutions: ["0.5K", "1K", "2K", "4K"],
      sizes: null,
      extra: { referenceField: "image_urls" },
    });
    expect(model.maxImages).toBeUndefined();
    expect(model.aspectRatios).toContain("1:1");
  });

  it("reads named sizes from FLUX.2 and a required single image from Kontext", () => {
    const flux = applySchema(
      byId("fal-ai/flux-2-pro"),
      inputSchema(schemasOf(flux2Pro))!,
    );
    expect(flux).toMatchObject({
      referenceImages: false,
      resolutions: null,
      extra: { sizeField: "image_size" },
    });
    expect(flux.sizes).toContain("square_hd");
    const edit = applySchema(
      byId("fal-ai/flux-pro/kontext"),
      inputSchema(schemasOf(kontext))!,
    );
    expect(edit).toMatchObject({
      referenceImages: true,
      imageRequired: true,
      maxImages: 1,
      extra: { referenceField: "image_url", referenceSingle: "true" },
    });
  });

  it("sends a single image as a string and a named size in its field", () => {
    expect(
      buildBody(
        {
          kind: "image",
          model: "m",
          prompt: "p",
          aspectRatio: "1:1",
          images: [{ role: "reference", dataUrl: "d" }],
        },
        { referenceField: "image_url", referenceSingle: "true" },
      ),
    ).toEqual({ prompt: "p", aspect_ratio: "1:1", image_url: "d" });
    expect(
      buildBody(
        {
          kind: "image",
          model: "m",
          prompt: "p",
          size: "square_hd",
          images: [],
        },
        { sizeField: "image_size" },
      ),
    ).toEqual({ prompt: "p", image_size: "square_hd" });
  });

  it("prices stills per image or per megapixel", () => {
    const of = (id: string) =>
      pricingFromPrices(
        imagePrices.prices.filter((p) => p.endpoint_id === id),
        "image",
      );
    expect(of("fal-ai/nano-banana-2")).toEqual({
      kind: "per-image",
      rates: [{ usd: 0.08 }],
    });
    expect(of("fal-ai/flux-2-pro")).toEqual({
      kind: "per-megapixel",
      usd: 0.03,
    });
  });

  it("pages through both image categories", async () => {
    const calls = mockFetch(
      Response.json({ ...imageList, models: imageList.models.slice(0, 2) }),
      Response.json({ ...imageList, models: imageList.models.slice(2) }),
      Response.json(imagePrices),
    );
    const models = await fal.listModels("k", "image");
    expect(
      calls.slice(0, 2).map((c) => new URL(c.url).searchParams.get("category")),
    ).toEqual(["text-to-image", "image-to-image"]);
    expect(models.map((m) => m.id)).toEqual([
      "fal-ai/nano-banana-2",
      "fal-ai/flux-2-pro",
      "fal-ai/nano-banana-2/edit",
      "fal-ai/flux-pro/kontext",
    ]);
    expect(models.find((m) => m.id === "fal-ai/flux-2-pro")?.pricing).toEqual({
      kind: "per-megapixel",
      usd: 0.03,
    });
  });

  it("finishes with the first image from the queue's result", async () => {
    mockFetch(
      stream([{ status: "COMPLETED", request_id: "req-1" }]),
      Response.json({
        images: [
          {
            url: "https://v3b.fal.media/files/i.png",
            content_type: "image/png",
          },
        ],
        description: "",
      }),
    );
    const events: JobEvent[] = [];
    for await (const event of fal.watch("k", job, new AbortController().signal))
      events.push(event);
    expect(events.at(-1)).toMatchObject({
      kind: "completed",
      result: { mediaUrl: "https://v3b.fal.media/files/i.png" },
    });
  });

  it("refuses a result on a host it may not contact", async () => {
    mockFetch(
      stream([{ status: "COMPLETED", request_id: "req-1" }]),
      Response.json({
        images: [{ url: "https://storage.googleapis.com/falserverless/i.png" }],
      }),
    );
    const events: JobEvent[] = [];
    for await (const event of fal.watch("k", job, new AbortController().signal))
      events.push(event);
    expect(events.at(-1)).toMatchObject({
      kind: "failed",
      error:
        "fal put the result on storage.googleapis.com, which take5 is not allowed to contact",
    });
  });
});
