import { PROVIDER_HOSTS } from "./hosts";
import {
  base64ToBlob,
  jsonInit,
  ProviderError,
  redactBase64,
  request,
  requestJson,
  sleep,
} from "./http";
import type {
  JobEvent,
  JobRef,
  KeyInfo,
  Pricing,
  MediaModel,
  MediaProvider,
  MediaRequest,
  PerImageRate,
  TerminalEvent,
} from "./types";

const API = "https://api.x.ai/v1";
const POLL_MS = 5000;

/** The models the docs list, with their flat per-second price, in case the
 * model endpoint is unavailable. */
export const KNOWN_MODELS: Array<{
  id: string;
  name: string;
  usdPerSecond: number;
}> = [
  {
    id: "grok-imagine-video-1.5",
    name: "Grok Imagine Video 1.5",
    usdPerSecond: 0.08,
  },
  {
    id: "grok-imagine-video-1.5-lite",
    name: "Grok Imagine Video 1.5 Lite",
    usdPerSecond: 0.02,
  },
  { id: "grok-imagine-video", name: "Grok Imagine Video", usdPerSecond: 0.05 },
];

/** The documented image models and their flat per-image price, for when the
 * model endpoint is unavailable or lists no price table. */
export const KNOWN_IMAGE_MODELS: Array<{
  id: string;
  name: string;
  usd: number;
}> = [
  { id: "grok-imagine-image-2.0", name: "Grok Imagine Image 2.0", usd: 0.04 },
  {
    id: "grok-imagine-image-quality",
    name: "Grok Imagine Image Quality",
    usd: 0.05,
  },
  { id: "grok-imagine-image", name: "Grok Imagine Image", usd: 0.02 },
];

/** Ticks are 1e-10 USD (a cent is 100,000,000 of them). */
const TICKS_PER_USD = 1e10;

/** The most images /v1/images/edits takes as `images`. */
const MAX_EDIT_IMAGES = 5;

const IMAGE_ASPECT_RATIOS = [
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "2:3",
  "3:2",
  "9:19.5",
  "19.5:9",
  "9:20",
  "20:9",
  "1:2",
  "2:1",
  "21:9",
  "5:2",
  "auto",
];

/** GET /v1/image-generation-models, one entry. */
export interface XaiImageModel {
  id: string;
  input_modalities?: string[];
  output_modalities?: string[];
  /**
   * Documented as USD cents but contradicted by live answers, so it is not
   * used; `pricing` carries exact amounts.
   */
  image_price?: number;
  pricing?: Array<{
    price_per_image: number;
    quality: string;
    resolution: string;
  }>;
}

/** POST /v1/images/generations and /v1/images/edits. */
export interface XaiImageResult {
  data?: Array<{ b64_json?: string | null; mime_type?: string | null }>;
  usage?: { cost_in_usd_ticks?: number };
}

const ASPECT_RATIOS = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "21:9",
  "5:2",
];

/** GET /v1/videos/{request_id}. */
export interface XaiJob {
  status: "pending" | "done" | "failed" | "expired" | string;
  video?: { url?: string; duration?: number };
  error?: { code?: string; message?: string } | string;
  model?: string;
}

function auth(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

export function pricingFor(id: string): Pricing | null {
  const known = KNOWN_MODELS.find((model) => model.id === id);
  return known
    ? { kind: "per-second", rates: [{ usdPerSecond: known.usdPerSecond }] }
    : null;
}

export function normalizeModel(id: string, name?: string): MediaModel {
  const classic = id === "grok-imagine-video";
  return {
    provider: "xai",
    kind: "video",
    id,
    name: name ?? KNOWN_MODELS.find((model) => model.id === id)?.name ?? id,
    frameImages: classic ? ["first_frame"] : ["first_frame", "last_frame"],
    referenceImages: true,
    audio: true,
    durations: Array.from({ length: 15 }, (_, i) => i + 1),
    resolutions: classic ? ["480p", "720p"] : ["480p", "720p", "1080p"],
    aspectRatios: ASPECT_RATIOS,
    sizes: null,
    pricing: pricingFor(id),
  };
}

/** Reads model ids out of whatever shape the model endpoint answers with. */
export function modelIds(payload: unknown): string[] {
  const list = Array.isArray(payload)
    ? payload
    : ((payload as { models?: unknown[]; data?: unknown[] })?.models ??
      (payload as { data?: unknown[] })?.data ??
      []);
  return list
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : ((entry as { id?: string; name?: string })?.id ??
          (entry as { name?: string })?.name),
    )
    .filter((id): id is string => typeof id === "string" && /video/.test(id));
}

export function buildBody(req: MediaRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { model: req.model };
  if (req.prompt) body.prompt = req.prompt;
  if (req.duration !== undefined) body.duration = req.duration;
  if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;
  if (req.resolution) body.resolution = req.resolution;
  if (req.audio !== undefined) body.generate_audio = req.audio;
  const references: Array<{ url: string }> = [];
  for (const image of req.images) {
    if (image.role === "first_frame") body.image = { url: image.dataUrl };
    else if (image.role === "last_frame")
      body.last_frame = { url: image.dataUrl };
    else references.push({ url: image.dataUrl });
  }
  if (references.length) body.reference_images = references;
  return body;
}

/**
 * An image model's per-image price: the cheapest quality at each
 * resolution from its price table, else the documented flat price.
 */
export function imagePricing(model: XaiImageModel): Pricing | null {
  if (model.pricing?.length) {
    const byResolution = new Map<string, number>();
    for (const tier of model.pricing) {
      const usd = tier.price_per_image / TICKS_PER_USD;
      const known = byResolution.get(tier.resolution);
      if (known === undefined || usd < known)
        byResolution.set(tier.resolution, usd);
    }
    const rates: PerImageRate[] = [...byResolution].map(
      ([resolution, usd]) => ({ usd, resolution }),
    );
    return { kind: "per-image", rates };
  }
  const known = KNOWN_IMAGE_MODELS.find((m) => m.id === model.id);
  return known ? { kind: "per-image", rates: [{ usd: known.usd }] } : null;
}

export function normalizeImageModel(model: XaiImageModel): MediaModel {
  const editable = model.input_modalities?.includes("image") ?? true;
  const resolutions = model.pricing?.length
    ? [...new Set(model.pricing.map((tier) => tier.resolution))]
    : ["1k", "2k"];
  return {
    provider: "xai",
    kind: "image",
    id: model.id,
    name: KNOWN_IMAGE_MODELS.find((m) => m.id === model.id)?.name ?? model.id,
    frameImages: [],
    referenceImages: editable,
    ...(editable ? { maxImages: MAX_EDIT_IMAGES } : {}),
    audio: null,
    durations: null,
    resolutions,
    aspectRatios: IMAGE_ASPECT_RATIOS,
    sizes: null,
    pricing: imagePricing(model),
  };
}

/**
 * Generations for a prompt alone; edits once there is an input image, as
 * `image` for one and `images` for several. Asks for base64, so the image
 * comes back in the answer and no other host is contacted.
 */
export function buildImageRequest(req: MediaRequest): {
  path: string;
  body: Record<string, unknown>;
} {
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt,
    response_format: "b64_json",
  };
  if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;
  if (req.resolution) body.resolution = req.resolution;
  const refs = req.images.map((image) => ({
    url: image.dataUrl,
    type: "image_url",
  }));
  if (!refs.length) return { path: "/images/generations", body };
  if (refs.length === 1) body.image = refs[0];
  else body.images = refs;
  return { path: "/images/edits", body };
}

export function imageAnswer(result: XaiImageResult): TerminalEvent {
  const at = Date.now();
  const raw = redactBase64(result);
  const image = result.data?.[0];
  if (!image?.b64_json) {
    return { kind: "failed", at, error: "No image in the result", raw };
  }
  const ticks = result.usage?.cost_in_usd_ticks;
  return {
    kind: "completed",
    at,
    result: {
      media: base64ToBlob(image.b64_json, image.mime_type ?? "image/jpeg"),
      costUsd: typeof ticks === "number" ? ticks / TICKS_PER_USD : undefined,
    },
    raw,
  };
}

async function listImageModels(
  key: string,
  signal?: AbortSignal,
): Promise<MediaModel[]> {
  try {
    const { models } = await requestJson<{ models?: XaiImageModel[] }>(
      `${API}/image-generation-models`,
      { headers: auth(key), signal },
    );
    const images = (models ?? []).filter(
      (model) => model.output_modalities?.includes("image") ?? true,
    );
    if (images.length) return images.map(normalizeImageModel);
  } catch (error) {
    if ((error as ProviderError).isAuth) throw error;
    // Any other failure: fall back to the documented list below.
  }
  return KNOWN_IMAGE_MODELS.map((model) =>
    normalizeImageModel({ id: model.id, input_modalities: ["text", "image"] }),
  );
}

export function errorOf(job: XaiJob): string {
  if (typeof job.error === "string") return job.error;
  return job.error?.message ?? `Job ${job.status}`;
}

export const xai: MediaProvider = {
  id: "xai",
  label: "xAI (Grok Imagine)",
  keyUrl: "https://console.x.ai",
  keyHint: "xai-…",
  hosts: PROVIDER_HOSTS.xai,
  kinds: ["video", "image"],
  // The images endpoints answer with the image (as base64) in the response.
  answersAtSubmit: ["image"],
  canCancel: false,

  async validateKey(key, signal): Promise<KeyInfo> {
    const info = await requestJson<{ name?: string }>(`${API}/api-key`, {
      headers: auth(key),
      signal,
    });
    return { label: info.name };
  },

  async listModels(key, kind, signal): Promise<MediaModel[]> {
    if (kind === "image") return listImageModels(key, signal);
    try {
      const payload = await requestJson<unknown>(
        `${API}/video-generation-models`,
        {
          headers: auth(key),
          signal,
        },
      );
      const ids = modelIds(payload);
      if (ids.length) return ids.map((id) => normalizeModel(id));
    } catch (error) {
      if ((error as ProviderError).isAuth) throw error;
      // Any other failure: fall back to the documented list below.
    }
    return KNOWN_MODELS.map((model) => normalizeModel(model.id, model.name));
  },

  async submit(key, req, signal): Promise<JobRef> {
    if (req.kind === "image") {
      const { path, body } = buildImageRequest(req);
      const result = await requestJson<XaiImageResult>(
        `${API}${path}`,
        jsonInit(auth(key), body, signal),
      );
      return {
        provider: "xai",
        id: `image-${Date.now().toString(36)}`,
        model: req.model,
        submittedAt: Date.now(),
        answer: imageAnswer(result),
      };
    }
    const data = await requestJson<{ request_id: string }>(
      `${API}/videos/generations`,
      jsonInit(auth(key), buildBody(req), signal),
    );
    return {
      provider: "xai",
      id: data.request_id,
      model: req.model,
      submittedAt: Date.now(),
    };
  },

  async *watch(key, job, signal): AsyncGenerator<JobEvent> {
    let last: string | undefined;
    for (;;) {
      const state = await requestJson<XaiJob>(
        `${API}/videos/${encodeURIComponent(job.id)}`,
        { headers: auth(key), signal },
      );
      const at = Date.now();
      if (state.status === "done") {
        if (!state.video?.url) {
          yield {
            kind: "failed",
            at,
            error: "No video in the result",
            raw: state,
          };
          return;
        }
        yield {
          kind: "completed",
          at,
          result: { mediaUrl: state.video.url },
          raw: state,
        };
        return;
      }
      if (state.status === "failed" || state.status === "expired") {
        yield { kind: "failed", at, error: errorOf(state), raw: state };
        return;
      }
      if (state.status !== last) {
        last = state.status;
        yield {
          kind: "status",
          at,
          status: state.status === "pending" ? "queued" : "running",
          raw: state,
        };
      }
      await sleep(POLL_MS, signal);
    }
  },

  async fetchMedia(_key, _job, result, signal): Promise<Blob> {
    if (!result.mediaUrl) throw new ProviderError("No video URL to download");
    const response = await request(result.mediaUrl, { signal });
    return response.blob();
  },
};
