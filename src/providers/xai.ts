import { PROVIDER_HOSTS } from "./hosts";
import { jsonInit, ProviderError, request, requestJson, sleep } from "./http";
import type {
  JobEvent,
  JobRef,
  KeyInfo,
  Pricing,
  MediaModel,
  MediaProvider,
  MediaRequest,
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
  kinds: ["video"],
  canCancel: false,

  async validateKey(key, signal): Promise<KeyInfo> {
    const info = await requestJson<{ name?: string }>(`${API}/api-key`, {
      headers: auth(key),
      signal,
    });
    return { label: info.name };
  },

  async listModels(key, kind, signal): Promise<MediaModel[]> {
    if (kind !== "video") return [];
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
