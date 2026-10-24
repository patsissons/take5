import { PROVIDER_HOSTS } from "./hosts";
import {
  base64ToBlob,
  isAbort,
  jsonInit,
  redactBase64,
  request,
  requestJson,
  sleep,
} from "./http";
import type {
  FrameRole,
  JobEvent,
  JobRef,
  JobResult,
  JobStatus,
  KeyInfo,
  PerImageRate,
  PerSecondRate,
  Pricing,
  MediaModel,
  MediaProvider,
  MediaRequest,
  TerminalEvent,
} from "./types";

const API = "https://openrouter.ai/api/v1";
const POLL_MS = 3000;
/** How many image models' prices are fetched at once. */
const PRICE_CONCURRENCY = 8;

/** GET /api/v1/videos/models, one entry. */
export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  supported_resolutions: string[] | null;
  supported_aspect_ratios: string[] | null;
  supported_sizes: string[] | null;
  supported_durations: number[] | null;
  supported_frame_images: string[] | null;
  generate_audio: boolean | null;
  seed: boolean | null;
  pricing_skus: Record<string, string> | null;
  upscale_factor?: unknown;
  creativity?: unknown;
}

/** GET /api/v1/videos/{id}. */
export interface OpenRouterJob {
  id: string;
  status:
    | "pending"
    | "in_progress"
    | "completed"
    | "failed"
    | "cancelled"
    | "expired";
  polling_url?: string;
  error?: string;
  urls?: string[];
  unsigned_urls?: string[];
  usage?: { cost?: number | null };
}

/** A parameter an image model accepts, as GET /api/v1/images/models lists it. */
export type ImageParameter =
  | { type: "enum"; values: string[] }
  | { type: "range"; min: number; max: number }
  | { type: "boolean" };

/** GET /api/v1/images/models, one entry. */
export interface OpenRouterImageModel {
  id: string;
  name: string;
  description?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: Record<string, ImageParameter>;
}

/** GET /api/v1/images/models/{id}/endpoints, one price line. */
export interface ImagePrice {
  billable: string;
  unit: string;
  cost_usd: number;
  variant?: string;
}

export interface ImageEndpoints {
  id: string;
  endpoints: Array<{ provider_name?: string; pricing?: ImagePrice[] }>;
}

/** POST /api/v1/images. */
export interface OpenRouterImageResult {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  usage?: { cost?: number | null };
}

function auth(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

/**
 * pricing_skus is a bag of provider SKUs. The per-second ones are usable:
 * `cents_per_video_output_second_720p`, `cents_per_second_output`,
 * `duration_seconds_with_audio_720p`, `text_to_video_duration_seconds_480p`…
 * (`cents_` keys are cents, the rest USD). Token-priced models get a note.
 */
export function pricingFromSkus(
  skus: Record<string, string> | null,
): Pricing | null {
  if (!skus) return null;
  const rates: PerSecondRate[] = [];
  for (const [sku, value] of Object.entries(skus)) {
    if (!/second/.test(sku) || /continuation|megapixel|minimum/.test(sku)) {
      continue;
    }
    const amount = Number(value);
    if (!Number.isFinite(amount)) continue;
    const rate: PerSecondRate = {
      usdPerSecond: sku.startsWith("cents_") ? amount / 100 : amount,
    };
    const resolution = /_(\d+p|\dk)(?:_|$)/i.exec(sku)?.[1];
    if (resolution)
      rate.resolution = resolution.toUpperCase().replace("P", "p");
    if (/with_audio/.test(sku)) rate.audio = true;
    if (/without_audio/.test(sku)) rate.audio = false;
    if (/^image_to_video/.test(sku)) rate.imageInput = true;
    if (/^text_to_video/.test(sku)) rate.imageInput = false;
    rates.push(rate);
  }
  if (rates.length) return { kind: "per-second", rates };
  if (Object.keys(skus).some((sku) => /token/.test(sku))) {
    return { kind: "unknown", note: "Priced per video token" };
  }
  return { kind: "unknown", note: "See OpenRouter for pricing" };
}

export function normalizeModel(model: OpenRouterModel): MediaModel {
  const frames = (model.supported_frame_images ?? []).filter(
    (frame): frame is FrameRole =>
      frame === "first_frame" || frame === "last_frame",
  );
  return {
    provider: "openrouter",
    kind: "video",
    id: model.id,
    name: model.name,
    description: model.description,
    frameImages: frames,
    // OpenRouter accepts input_references for any model; providers ignore
    // what they cannot use.
    referenceImages: true,
    audio: model.generate_audio,
    durations: model.supported_durations,
    resolutions: model.supported_resolutions,
    aspectRatios: model.supported_aspect_ratios,
    sizes: model.supported_sizes,
    pricing: pricingFromSkus(model.pricing_skus),
  };
}

function enumValues(param: ImageParameter | undefined): string[] | null {
  return param?.type === "enum" && param.values.length ? param.values : null;
}

export function normalizeImageModel(model: OpenRouterImageModel): MediaModel {
  const params = model.supported_parameters ?? {};
  const references = params.input_references;
  const maxImages = references?.type === "range" ? references.max : 0;
  return {
    provider: "openrouter",
    kind: "image",
    id: model.id,
    name: model.name,
    description: model.description,
    frameImages: [],
    // Only models that list input_references take them.
    referenceImages: maxImages > 0,
    ...(maxImages > 0 ? { maxImages } : {}),
    ...(references?.type === "range" && references.min > 0
      ? { imageRequired: true }
      : {}),
    audio: null,
    durations: null,
    resolutions: enumValues(params.resolution),
    aspectRatios: enumValues(params.aspect_ratio),
    sizes: enumValues(params.size),
    pricing: null,
  };
}

/**
 * An image model's price, from the first endpoint that lists one. Only the
 * output image counts. Per-image variants carry the resolution in their
 * name (`low_1k`, `medium_2k`, `1k`); the cheapest per resolution is kept.
 */
export function pricingFromEndpoints(
  data: ImageEndpoints | undefined,
): Pricing | null {
  const lines =
    data?.endpoints
      .map((endpoint) =>
        (endpoint.pricing ?? []).filter((p) => p.billable === "output_image"),
      )
      .find((output) => output.length) ?? [];
  if (!lines.length) return null;
  if (lines.every((line) => line.unit === "image")) {
    const byResolution = new Map<string | undefined, number>();
    for (const line of lines) {
      const resolution = /(?:^|_)(\d+(?:\.\d+)?k|\d{3,4})(?:_|$)/i
        .exec(line.variant ?? "")?.[1]
        ?.toUpperCase();
      const known = byResolution.get(resolution);
      if (known === undefined || line.cost_usd < known) {
        byResolution.set(resolution, line.cost_usd);
      }
    }
    const rates: PerImageRate[] = [...byResolution].map(([resolution, usd]) =>
      resolution ? { usd, resolution } : { usd },
    );
    return { kind: "per-image", rates };
  }
  const megapixel = lines.find((line) => line.unit === "megapixel");
  if (megapixel) return { kind: "per-megapixel", usd: megapixel.cost_usd };
  if (lines.some((line) => line.unit === "token")) {
    return { kind: "unknown", note: "Priced per image token" };
  }
  const first = lines[0]!;
  return { kind: "unknown", note: `$${first.cost_usd} per ${first.unit}` };
}

export function buildImageBody(req: MediaRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt,
  };
  if (req.size) body.size = req.size;
  else {
    if (req.resolution) body.resolution = req.resolution;
    if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;
  }
  if (req.images.length) {
    body.input_references = req.images.map((image) => ({
      type: "image_url",
      image_url: { url: image.dataUrl },
    }));
  }
  return body;
}

/** The finished image, or why there is none, as the run's ending. */
export function imageAnswer(result: OpenRouterImageResult): TerminalEvent {
  const at = Date.now();
  const raw = redactBase64(result);
  const image = result.data?.[0];
  if (!image?.b64_json) {
    return { kind: "failed", at, error: "No image in the result", raw };
  }
  const cost = result.usage?.cost;
  return {
    kind: "completed",
    at,
    result: {
      media: base64ToBlob(image.b64_json, image.media_type ?? "image/png"),
      costUsd: typeof cost === "number" ? cost : undefined,
    },
    raw,
  };
}

/** Prices for every image model, a few at a time; a failure leaves one unpriced. */
async function imagePrices(
  key: string,
  ids: string[],
  signal?: AbortSignal,
): Promise<Map<string, Pricing | null>> {
  const prices = new Map<string, Pricing | null>();
  for (let i = 0; i < ids.length; i += PRICE_CONCURRENCY) {
    await Promise.all(
      ids.slice(i, i + PRICE_CONCURRENCY).map(async (id) => {
        try {
          const data = await requestJson<ImageEndpoints>(
            `${API}/images/models/${id}/endpoints`,
            { headers: key ? auth(key) : {}, signal },
          );
          prices.set(id, pricingFromEndpoints(data));
        } catch (error) {
          if (isAbort(error)) throw error;
        }
      }),
    );
  }
  return prices;
}

async function listImageModels(
  key: string,
  signal?: AbortSignal,
): Promise<MediaModel[]> {
  const { data } = await requestJson<{ data: OpenRouterImageModel[] }>(
    `${API}/images/models`,
    { headers: key ? auth(key) : {}, signal },
  );
  const models = data.map(normalizeImageModel);
  const prices = await imagePrices(
    key,
    models.map((model) => model.id),
    signal,
  );
  return models.map((model) => ({
    ...model,
    pricing: prices.get(model.id) ?? null,
  }));
}

/** Video models only: upscalers and editors take a video, not a prompt. */
export function isGenerationModel(model: OpenRouterModel): boolean {
  return !model.upscale_factor && !/upscale|-edit\b/.test(model.id);
}

export function buildBody(req: MediaRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt,
  };
  if (req.duration !== undefined) body.duration = req.duration;
  if (req.size) body.size = req.size;
  else {
    if (req.resolution) body.resolution = req.resolution;
    if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;
  }
  if (req.audio !== undefined) body.generate_audio = req.audio;
  const frames = req.images.filter((image) => image.role !== "reference");
  const references = req.images.filter((image) => image.role === "reference");
  if (frames.length) {
    body.frame_images = frames.map((image) => ({
      type: "image_url",
      image_url: { url: image.dataUrl },
      frame_type: image.role,
    }));
  }
  if (references.length) {
    body.input_references = references.map((image) => ({
      type: "image_url",
      image_url: { url: image.dataUrl },
    }));
  }
  return body;
}

export function mapStatus(status: OpenRouterJob["status"]): JobStatus {
  switch (status) {
    case "pending":
      return "queued";
    case "in_progress":
      return "running";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    default:
      return "failed";
  }
}

export function resultOf(job: OpenRouterJob): JobResult {
  const cost = job.usage?.cost;
  return {
    costUsd: typeof cost === "number" ? cost : undefined,
    mediaUrl: job.urls?.[0],
  };
}

export const openrouter: MediaProvider = {
  id: "openrouter",
  label: "OpenRouter",
  keyUrl: "https://openrouter.ai/settings/keys",
  keyHint: "sk-or-v1-…",
  hosts: PROVIDER_HOSTS.openrouter,
  kinds: ["video", "image"],
  // POST /api/v1/images answers with the image itself.
  answersAtSubmit: ["image"],
  canCancel: false,

  async validateKey(key, signal): Promise<KeyInfo> {
    const { data } = await requestJson<{
      data: { label?: string; limit_remaining?: number | null };
    }>(`${API}/key`, { headers: auth(key), signal });
    return { label: data.label, remainingUsd: data.limit_remaining ?? null };
  },

  async listModels(key, kind, signal): Promise<MediaModel[]> {
    if (kind === "image") return listImageModels(key, signal);
    const { data } = await requestJson<{ data: OpenRouterModel[] }>(
      `${API}/videos/models`,
      { headers: key ? auth(key) : {}, signal },
    );
    return data.filter(isGenerationModel).map(normalizeModel);
  },

  async submit(key, req, signal): Promise<JobRef> {
    if (req.kind === "image") {
      const result = await requestJson<OpenRouterImageResult>(
        `${API}/images`,
        jsonInit(auth(key), buildImageBody(req), signal),
      );
      return {
        provider: "openrouter",
        id: `image-${Date.now().toString(36)}`,
        model: req.model,
        submittedAt: Date.now(),
        answer: imageAnswer(result),
      };
    }
    const job = await requestJson<OpenRouterJob>(
      `${API}/videos`,
      jsonInit(auth(key), buildBody(req), signal),
    );
    return {
      provider: "openrouter",
      id: job.id,
      model: req.model,
      submittedAt: Date.now(),
    };
  },

  async *watch(key, job, signal): AsyncGenerator<JobEvent> {
    let last: JobStatus | undefined;
    for (;;) {
      const state = await requestJson<OpenRouterJob>(
        `${API}/videos/${encodeURIComponent(job.id)}`,
        { headers: auth(key), signal },
      );
      const status = mapStatus(state.status);
      const at = Date.now();
      if (status === "completed") {
        yield { kind: "completed", at, result: resultOf(state), raw: state };
        return;
      }
      if (status === "failed" || status === "cancelled") {
        yield {
          kind: "failed",
          at,
          error: state.error || `Job ${state.status}`,
          raw: state,
        };
        return;
      }
      if (status !== last) {
        last = status;
        yield { kind: "status", at, status, raw: state };
      }
      await sleep(POLL_MS, signal);
    }
  },

  async fetchMedia(key, job, _result, signal): Promise<Blob> {
    const response = await request(
      `${API}/videos/${encodeURIComponent(job.id)}/content?index=0`,
      { headers: auth(key), signal },
    );
    return response.blob();
  },
};
