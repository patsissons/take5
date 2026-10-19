import { PROVIDER_HOSTS } from "./hosts";
import { jsonInit, request, requestJson, sleep } from "./http";
import type {
  FrameRole,
  JobEvent,
  JobRef,
  JobResult,
  JobStatus,
  KeyInfo,
  PerSecondRate,
  Pricing,
  VideoModel,
  VideoProvider,
  VideoRequest,
} from "./types";

const API = "https://openrouter.ai/api/v1";
const POLL_MS = 3000;

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

export function normalizeModel(model: OpenRouterModel): VideoModel {
  const frames = (model.supported_frame_images ?? []).filter(
    (frame): frame is FrameRole =>
      frame === "first_frame" || frame === "last_frame",
  );
  return {
    provider: "openrouter",
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

/** Video models only: upscalers and editors take a video, not a prompt. */
export function isGenerationModel(model: OpenRouterModel): boolean {
  return !model.upscale_factor && !/upscale|-edit\b/.test(model.id);
}

export function buildBody(req: VideoRequest): Record<string, unknown> {
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
    videoUrl: job.urls?.[0],
  };
}

export const openrouter: VideoProvider = {
  id: "openrouter",
  label: "OpenRouter",
  keyUrl: "https://openrouter.ai/settings/keys",
  keyHint: "sk-or-v1-…",
  hosts: PROVIDER_HOSTS.openrouter,
  canCancel: false,

  async validateKey(key, signal): Promise<KeyInfo> {
    const { data } = await requestJson<{
      data: { label?: string; limit_remaining?: number | null };
    }>(`${API}/key`, { headers: auth(key), signal });
    return { label: data.label, remainingUsd: data.limit_remaining ?? null };
  },

  async listModels(key, signal): Promise<VideoModel[]> {
    const { data } = await requestJson<{ data: OpenRouterModel[] }>(
      `${API}/videos/models`,
      { headers: key ? auth(key) : {}, signal },
    );
    return data.filter(isGenerationModel).map(normalizeModel);
  },

  async submit(key, req, signal): Promise<JobRef> {
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

  async fetchVideo(key, job, _result, signal): Promise<Blob> {
    const response = await request(
      `${API}/videos/${encodeURIComponent(job.id)}/content?index=0`,
      { headers: auth(key), signal },
    );
    return response.blob();
  },
};
