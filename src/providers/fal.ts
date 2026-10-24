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
  MediaKind,
  Pricing,
  MediaModel,
  MediaProvider,
  MediaRequest,
} from "./types";

const API = "https://api.fal.ai/v1";
const QUEUE = "https://queue.fal.run";
const PAGE = 50;
const MAX_PAGES = 10;
const POLL_MS = 3000;
/** The most endpoint ids the pricing endpoint takes in one call. */
const PRICES_PER_CALL = 50;

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

/** The model list's categories for each kind. */
const CATEGORIES: Record<MediaKind, string[]> = {
  video: ["text-to-video", "image-to-video"],
  image: ["text-to-image", "image-to-image"],
};

/**
 * image-to-image also lists tools that take no prompt (upscalers,
 * background removal, segmentation…); they are not generators.
 */
const IMAGE_TOOLS =
  /upscal|background|rembg|birefnet|segment|sam-\d|vectori[sz]e|extract-frame|depth|preprocessor|eraser|expand|aura-sr|esrgan|clarity/i;

export function kindOf(model: FalModel): MediaKind {
  return /-to-image$/.test(model.metadata.category) ? "image" : "video";
}

export function normalizeModel(model: FalModel): MediaModel {
  const kind = kindOf(model);
  const category = model.metadata.category;
  return {
    provider: "fal",
    kind,
    id: model.endpoint_id,
    name: model.metadata.display_name,
    description: model.metadata.description,
    frameImages: category === "image-to-video" ? ["first_frame"] : [],
    // Until the schema says which field, an editor is assumed to take one.
    referenceImages: category === "image-to-image",
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
    (model.metadata.kind ?? "inference") === "inference" &&
    !(
      kindOf(model) === "image" &&
      IMAGE_TOOLS.test(`${model.endpoint_id} ${model.metadata.display_name}`)
    )
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
export function applySchema(model: MediaModel, input: JsonSchema): MediaModel {
  if (model.kind === "image") return applyImageSchema(model, input);
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

/**
 * A still model's inputs: a list of reference images (`image_urls`) or a
 * single one (`image_url`, required by editors like Kontext), and its
 * resolutions, aspect ratios or named sizes (`image_size`).
 */
function applyImageSchema(model: MediaModel, input: JsonSchema): MediaModel {
  const props = input.properties ?? {};
  const keys = Object.keys(props);
  const required = input.required ?? [];
  const extra: Record<string, string> = { ...model.extra };
  const list = REFERENCE_FIELDS.find((f) => keys.includes(f));
  const single = keys.includes("image_url") ? "image_url" : undefined;
  const reference = list ?? single;
  delete extra.referenceField;
  delete extra.referenceSingle;
  delete extra.sizeField;
  if (reference) extra.referenceField = reference;
  if (!list && single) extra.referenceSingle = "true";
  const sizes = enumOf(props.image_size);
  if (sizes) extra.sizeField = "image_size";
  return {
    ...model,
    frameImages: [],
    referenceImages: !!reference,
    maxImages: reference ? (list ? undefined : 1) : undefined,
    imageRequired: !!reference && required.includes(reference),
    resolutions: enumOf(props.resolution),
    aspectRatios: enumOf(props.aspect_ratio),
    sizes,
    extra,
  };
}

export function pricingFromPrices(
  prices: FalPrice[] | undefined,
  kind: MediaKind = "video",
): Pricing | null {
  const price = prices?.[0];
  if (!price) return null;
  if (kind === "image") {
    if (/megapixel/.test(price.unit)) {
      return { kind: "per-megapixel", usd: price.unit_price };
    }
    if (/image|request|generation/.test(price.unit)) {
      return { kind: "per-image", rates: [{ usd: price.unit_price }] };
    }
  } else if (/second/.test(price.unit)) {
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

/**
 * Prices for many endpoints at once, by endpoint id, so the model list can
 * show (and filter by) cost before any model is inspected. A failed chunk
 * only leaves its models unpriced.
 */
export async function listPrices(
  key: string,
  ids: string[],
  signal?: AbortSignal,
): Promise<Map<string, FalPrice[]>> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += PRICES_PER_CALL) {
    chunks.push(ids.slice(i, i + PRICES_PER_CALL));
  }
  const answers = await Promise.all(
    chunks.map((chunk) =>
      requestJson<{ prices: FalPrice[] }>(
        `${API}/models/pricing?endpoint_id=${chunk.map(encodeURIComponent).join(",")}`,
        { headers: auth(key), signal },
      ).catch((error: unknown) => {
        if (isAbort(error)) throw error;
        return { prices: [] };
      }),
    ),
  );
  const byId = new Map<string, FalPrice[]>();
  for (const price of answers.flatMap((answer) => answer.prices ?? [])) {
    byId.set(price.endpoint_id, [
      ...(byId.get(price.endpoint_id) ?? []),
      price,
    ]);
  }
  return byId;
}

export function buildBody(
  req: MediaRequest,
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
  if (req.size && extra.sizeField) body[extra.sizeField] = req.size;
  for (const image of req.images) {
    if (image.role === "first_frame") {
      body[extra.firstFrameField ?? "image_url"] = image.dataUrl;
    } else if (image.role === "last_frame") {
      body[extra.lastFrameField ?? "end_image_url"] = image.dataUrl;
    } else if (extra.referenceSingle) {
      body[extra.referenceField!] = image.dataUrl;
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

export const fal: MediaProvider = {
  id: "fal",
  label: "fal",
  keyUrl: "https://fal.ai/dashboard/keys",
  keyHint: "key_id:key_secret",
  hosts: PROVIDER_HOSTS.fal,
  // Images go through the same queue as videos, so they resume too.
  kinds: ["video", "image"],
  canCancel: true,

  async validateKey(key, signal): Promise<KeyInfo> {
    // The pricing endpoint is the cheapest call that checks the key.
    await requestJson(`${API}/models/pricing?endpoint_id=fal-ai/flux/dev`, {
      headers: auth(key),
      signal,
    });
    return {};
  },

  async listModels(key, kind, signal): Promise<MediaModel[]> {
    const models: FalModel[] = [];
    for (const category of CATEGORIES[kind]) {
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
    const usable = models
      .filter(
        (model) =>
          isUsable(model) &&
          !seen.has(model.endpoint_id) &&
          seen.add(model.endpoint_id),
      )
      .map(normalizeModel);
    const prices = await listPrices(
      key,
      usable.map((model) => model.id),
      signal,
    );
    return usable.map((model) => ({
      ...model,
      pricing: pricingFromPrices(prices.get(model.id), model.kind),
    }));
  },

  async inspectModel(key, model, signal): Promise<MediaModel> {
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
    return {
      ...detailed,
      pricing: pricingFromPrices(prices, model.kind) ?? model.pricing,
    };
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
      images?: Array<{ url?: string }>;
      error?: string;
    }>(job.extra!.responseUrl!, { headers: auth(key), signal });
    const url = result.video?.url ?? result.images?.[0]?.url;
    if (!url) {
      yield {
        kind: "failed",
        at: Date.now(),
        error: result.error ?? "No video or image in the result",
        raw: result,
      };
      return;
    }
    // A few older endpoints keep results off fal's media CDN, on a host the
    // Content-Security-Policy blocks: say so instead of failing to fetch.
    const host = new URL(url).host;
    if (!/(^|\.)fal\.media$/.test(host)) {
      yield {
        kind: "failed",
        at: Date.now(),
        error: `fal put the result on ${host}, which take5 is not allowed to contact`,
        raw: result,
      };
      return;
    }
    yield {
      kind: "completed",
      at: Date.now(),
      result: { mediaUrl: url },
      raw: result,
    };
  },

  async fetchMedia(_key, _job, result, signal): Promise<Blob> {
    if (!result.mediaUrl) throw new ProviderError("No URL to download");
    const response = await request(result.mediaUrl, { signal });
    return response.blob();
  },

  async cancel(key, job): Promise<void> {
    await request(job.extra!.cancelUrl!, { method: "PUT", headers: auth(key) });
  },
};
