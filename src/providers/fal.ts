import { PROVIDER_HOSTS } from "./hosts";
import {
  isAbort,
  jsonInit,
  ProviderError,
  request,
  requestJson,
  sleep,
  sse,
} from "./http";
import type {
  FrameRole,
  JobEvent,
  JobRef,
  KeyInfo,
  Pricing,
  VideoModel,
  VideoProvider,
  VideoRequest,
} from "./types";

const API = "https://api.fal.ai/v1";
const QUEUE = "https://queue.fal.run";
const PAGE = 50;
const MAX_PAGES = 10;
const POLL_MS = 3000;

/** One entry of GET api.fal.ai/v1/models. */
export interface FalModel {
  endpoint_id: string;
  metadata: {
    display_name: string;
    category: string;
    description?: string;
    status: string;
    kind?: string;
  };
  openapi?: { components?: { schemas?: Record<string, JsonSchema> } };
}

export interface JsonSchema {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
}

export interface FalPrice {
  endpoint_id: string;
  unit_price: number;
  unit: string;
  currency: string;
}

/** The queue's status payload (polled or streamed). */
export interface FalStatus {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  request_id: string;
  queue_position?: number;
  response_url?: string;
  logs?: Array<{ message: string; timestamp?: string }>;
  error?: string;
  error_type?: string;
}

function auth(key: string): Record<string, string> {
  return { authorization: `Key ${key}` };
}

const FIRST_FRAME_FIELDS = [
  "image_url",
  "start_image_url",
  "first_frame_url",
  "first_image_url",
  "input_image_url",
];
const LAST_FRAME_FIELDS = [
  "end_image_url",
  "last_image_url",
  "last_frame_url",
  "tail_image_url",
];
const REFERENCE_FIELDS = ["reference_image_urls", "image_urls"];

export function normalizeModel(model: FalModel): VideoModel {
  const imageToVideo = model.metadata.category === "image-to-video";
  return {
    provider: "fal",
    id: model.endpoint_id,
    name: model.metadata.display_name,
    description: model.metadata.description,
    frameImages: imageToVideo ? ["first_frame"] : [],
    referenceImages: false,
    audio: null,
    durations: null,
    resolutions: null,
    aspectRatios: null,
    sizes: null,
    pricing: null,
    extra: { category: model.metadata.category },
  };
}

export function isUsable(model: FalModel): boolean {
  return (
    model.metadata.status === "active" &&
    (model.metadata.kind ?? "inference") === "inference"
  );
}

/** The request schema: the `*Input` object that takes a prompt or an image. */
export function inputSchema(
  schemas: Record<string, JsonSchema> | undefined,
): JsonSchema | undefined {
  if (!schemas) return undefined;
  const candidates = Object.entries(schemas)
    .filter(([name, schema]) => name.endsWith("Input") && schema.properties)
    .map(([, schema]) => schema)
    .filter((schema) => {
      const keys = Object.keys(schema.properties!);
      return keys.includes("prompt") || keys.some((k) => /image_url/.test(k));
    });
  return candidates.sort(
    (a, b) =>
      Object.keys(b.properties!).length - Object.keys(a.properties!).length,
  )[0];
}

function enumOf(schema: JsonSchema | undefined): string[] | null {
  const values = schema?.enum ?? schema?.anyOf?.find((s) => s.enum)?.enum;
  return values?.length ? values.map(String) : null;
}

/** Applies what the endpoint's OpenAPI input schema says it accepts. */
export function applySchema(model: VideoModel, input: JsonSchema): VideoModel {
  const props = input.properties ?? {};
  const keys = Object.keys(props);
  const extra: Record<string, string> = { ...model.extra };
  const frames: FrameRole[] = [];
  const first = FIRST_FRAME_FIELDS.find((f) => keys.includes(f));
  if (first) {
    frames.push("first_frame");
    extra.firstFrameField = first;
  }
  const last = LAST_FRAME_FIELDS.find((f) => keys.includes(f));
  if (last) {
    frames.push("last_frame");
    extra.lastFrameField = last;
  }
  const reference = REFERENCE_FIELDS.find((f) => keys.includes(f));
  if (reference) extra.referenceField = reference;

  const durationEnum = enumOf(props.duration);
  const durations = durationEnum
    ? durationEnum.map(Number).filter(Number.isFinite)
    : null;
  if (props.duration) {
    extra.durationType = props.duration.type === "string" ? "string" : "number";
  }
  if (keys.includes("generate_audio")) extra.audioField = "generate_audio";
  else if (keys.includes("audio")) extra.audioField = "audio";

  return {
    ...model,
    frameImages: frames,
    referenceImages: !!reference,
    audio: extra.audioField ? true : null,
    durations: durations?.length ? durations : null,
    resolutions: enumOf(props.resolution),
    aspectRatios: enumOf(props.aspect_ratio),
    extra,
  };
}

export function pricingFromPrices(
  prices: FalPrice[] | undefined,
): Pricing | null {
  const price = prices?.[0];
  if (!price) return null;
  if (/second/.test(price.unit)) {
    return { kind: "per-second", rates: [{ usdPerSecond: price.unit_price }] };
  }
  if (/video|request|generation/.test(price.unit)) {
    return { kind: "per-video", usd: price.unit_price };
  }
  return {
    kind: "unknown",
    note: `${price.unit_price} ${price.currency} per ${price.unit}`,
  };
}

export function buildBody(
  req: VideoRequest,
  extra: Record<string, string> = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (req.prompt) body.prompt = req.prompt;
  if (req.duration !== undefined) {
    body.duration =
      extra.durationType === "string" ? String(req.duration) : req.duration;
  }
  if (req.resolution) body.resolution = req.resolution;
  if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;
  if (req.audio !== undefined && extra.audioField)
    body[extra.audioField] = req.audio;
  for (const image of req.images) {
    if (image.role === "first_frame") {
      body[extra.firstFrameField ?? "image_url"] = image.dataUrl;
    } else if (image.role === "last_frame") {
      body[extra.lastFrameField ?? "end_image_url"] = image.dataUrl;
    } else {
      const field = extra.referenceField ?? "reference_image_urls";
      body[field] = [
        ...((body[field] as string[] | undefined) ?? []),
        image.dataUrl,
      ];
    }
  }
  return body;
}

function statusEvent(state: FalStatus, at: number): JobEvent {
  if (state.status === "IN_QUEUE") {
    return {
      kind: "status",
      at,
      status: "queued",
      queuePosition: state.queue_position,
      raw: state,
    };
  }
  return { kind: "status", at, status: "running", raw: state };
}

export const fal: VideoProvider = {
  id: "fal",
  label: "fal",
  keyUrl: "https://fal.ai/dashboard/keys",
  keyHint: "key_id:key_secret",
  hosts: PROVIDER_HOSTS.fal,
  canCancel: true,

  async validateKey(key, signal): Promise<KeyInfo> {
    // The pricing endpoint is the cheapest call that checks the key.
    await requestJson(`${API}/models/pricing?endpoint_id=fal-ai/flux/dev`, {
      headers: auth(key),
      signal,
    });
    return {};
  },

  async listModels(_key, signal): Promise<VideoModel[]> {
    const models: FalModel[] = [];
    for (const category of ["text-to-video", "image-to-video"]) {
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = new URL(`${API}/models`);
        url.searchParams.set("category", category);
        url.searchParams.set("limit", String(PAGE));
        if (cursor) url.searchParams.set("cursor", cursor);
        const data: {
          models: FalModel[];
          next_cursor: string | null;
          has_more: boolean;
        } = await requestJson(url.toString(), { signal });
        models.push(...data.models);
        if (!data.has_more || !data.next_cursor) break;
        cursor = data.next_cursor;
      }
    }
    const seen = new Set<string>();
    return models
      .filter(
        (model) =>
          isUsable(model) &&
          !seen.has(model.endpoint_id) &&
          seen.add(model.endpoint_id),
      )
      .map(normalizeModel);
  },

  async inspectModel(key, model, signal): Promise<VideoModel> {
    const [schema, prices] = await Promise.all([
      requestJson<{ models: FalModel[] }>(
        `${API}/models?endpoint_id=${encodeURIComponent(model.id)}&expand=openapi-3.0`,
        { signal },
      ).then((data) =>
        inputSchema(data.models[0]?.openapi?.components?.schemas),
      ),
      requestJson<{ prices: FalPrice[] }>(
        `${API}/models/pricing?endpoint_id=${encodeURIComponent(model.id)}`,
        { headers: auth(key), signal },
      )
        .then((data) => data.prices)
        .catch(() => undefined),
    ]);
    const detailed = schema ? applySchema(model, schema) : model;
    return { ...detailed, pricing: pricingFromPrices(prices) ?? model.pricing };
  },

  async submit(key, req, signal): Promise<JobRef> {
    const extra = req.extra ?? {};
    const data = await requestJson<{
      request_id: string;
      status_url?: string;
      response_url?: string;
      cancel_url?: string;
    }>(
      `${QUEUE}/${req.model}`,
      jsonInit(auth(key), buildBody(req, extra), signal),
    );
    const base = `${QUEUE}/${req.model}/requests/${data.request_id}`;
    return {
      provider: "fal",
      id: data.request_id,
      model: req.model,
      submittedAt: Date.now(),
      extra: {
        statusUrl: data.status_url ?? `${base}/status`,
        responseUrl: data.response_url ?? base,
        cancelUrl: data.cancel_url ?? `${base}/cancel`,
      },
    };
  },

  async *watch(key, job, signal): AsyncGenerator<JobEvent> {
    const statusUrl = job.extra!.statusUrl!;
    let logged = 0;
    let lastStatus: FalStatus["status"] | undefined;
    const handle = function* (state: FalStatus): Generator<JobEvent> {
      const at = Date.now();
      for (const log of (state.logs ?? []).slice(logged)) {
        yield { kind: "log", at, message: log.message, raw: log };
      }
      logged = Math.max(logged, state.logs?.length ?? 0);
      if (state.status === "COMPLETED") return;
      if (state.status !== lastStatus || state.status === "IN_QUEUE") {
        lastStatus = state.status;
        yield statusEvent(state, at);
      }
    };

    let final: FalStatus | undefined;
    // Live logs and queue position over SSE; fall back to polling if the
    // stream cannot be opened.
    try {
      const response = await request(`${statusUrl}/stream?logs=1`, {
        headers: { ...auth(key), accept: "text/event-stream" },
        signal,
      });
      for await (const state of sse<FalStatus>(response, signal)) {
        yield* handle(state);
        if (state.status === "COMPLETED") {
          final = state;
          break;
        }
      }
    } catch (error) {
      if (isAbort(error)) throw error;
    }
    while (!final) {
      const state = await requestJson<FalStatus>(`${statusUrl}?logs=1`, {
        headers: auth(key),
        signal,
      });
      yield* handle(state);
      if (state.status === "COMPLETED") final = state;
      else await sleep(POLL_MS, signal);
    }

    if (final.error) {
      yield { kind: "failed", at: Date.now(), error: final.error, raw: final };
      return;
    }
    const result = await requestJson<{
      video?: { url?: string };
      error?: string;
    }>(job.extra!.responseUrl!, { headers: auth(key), signal });
    if (!result.video?.url) {
      yield {
        kind: "failed",
        at: Date.now(),
        error: result.error ?? "No video in the result",
        raw: result,
      };
      return;
    }
    yield {
      kind: "completed",
      at: Date.now(),
      result: { videoUrl: result.video.url },
      raw: result,
    };
  },

  async fetchVideo(_key, _job, result, signal): Promise<Blob> {
    if (!result.videoUrl) throw new ProviderError("No video URL to download");
    const response = await request(result.videoUrl, { signal });
    return response.blob();
  },

  async cancel(key, job): Promise<void> {
    await request(job.extra!.cancelUrl!, { method: "PUT", headers: auth(key) });
  },
};
