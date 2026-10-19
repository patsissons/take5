import { PROVIDER_HOSTS } from "./hosts";
import {
  jsonInit,
  parseDataUrl,
  ProviderError,
  request,
  requestJson,
  sleep,
} from "./http";
import type {
  JobEvent,
  JobRef,
  KeyInfo,
  Pricing,
  VideoModel,
  VideoProvider,
  VideoRequest,
} from "./types";

const API = "https://generativelanguage.googleapis.com/v1beta";
const POLL_MS = 5000;

/** One entry of GET v1beta/models. */
export interface GeminiModel {
  name: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}

/** GET v1beta/{operation}. */
export interface GeminiOperation {
  name: string;
  done?: boolean;
  error?: { code?: number; message?: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>;
      raiMediaFilteredCount?: number;
      raiMediaFilteredReasons?: string[];
    };
  };
}

function auth(key: string): Record<string, string> {
  return { "x-goog-api-key": key };
}

/** USD per second of video (audio included), from the Gemini pricing page. */
export function pricingFor(id: string): Pricing | null {
  const rate = (usd: Record<string, number>): Pricing => ({
    kind: "per-second",
    rates: Object.entries(usd).map(([resolution, usdPerSecond]) => ({
      resolution,
      usdPerSecond,
    })),
  });
  if (!/veo-3\.1/.test(id)) return null;
  if (/lite/.test(id)) return rate({ "720p": 0.05, "1080p": 0.08 });
  if (/fast/.test(id)) return rate({ "720p": 0.1, "1080p": 0.12, "4k": 0.3 });
  return rate({ "720p": 0.4, "1080p": 0.4, "4k": 0.6 });
}

export function isVideoModel(model: GeminiModel): boolean {
  return (
    /veo/i.test(model.name) &&
    (model.supportedGenerationMethods ?? []).includes("predictLongRunning")
  );
}

export function normalizeModel(model: GeminiModel): VideoModel {
  const id = model.name.replace(/^models\//, "");
  const lite = /lite/.test(id);
  return {
    provider: "gemini",
    id,
    name: model.displayName ?? id,
    description: model.description,
    frameImages: ["first_frame", "last_frame"],
    referenceImages: !lite,
    // Veo always generates audio; there is nothing to toggle.
    audio: null,
    durations: [4, 6, 8],
    resolutions: lite ? ["720p", "1080p"] : ["720p", "1080p", "4k"],
    aspectRatios: ["16:9", "9:16"],
    sizes: null,
    pricing: pricingFor(id),
  };
}

function inline(dataUrl: string) {
  const { mimeType, base64 } = parseDataUrl(dataUrl);
  return { inlineData: { mimeType, data: base64 } };
}

export function buildBody(req: VideoRequest): Record<string, unknown> {
  const instance: Record<string, unknown> = { prompt: req.prompt };
  const references: unknown[] = [];
  for (const image of req.images) {
    if (image.role === "first_frame") instance.image = inline(image.dataUrl);
    else if (image.role === "last_frame")
      instance.lastFrame = inline(image.dataUrl);
    else
      references.push({ image: inline(image.dataUrl), referenceType: "asset" });
  }
  if (references.length) instance.referenceImages = references;
  const parameters: Record<string, unknown> = {};
  if (req.aspectRatio) parameters.aspectRatio = req.aspectRatio;
  if (req.resolution) parameters.resolution = req.resolution;
  if (req.duration !== undefined) parameters.durationSeconds = req.duration;
  return { instances: [instance], parameters };
}

export const gemini: VideoProvider = {
  id: "gemini",
  label: "Gemini (Veo)",
  keyUrl: "https://aistudio.google.com/app/apikey",
  keyHint: "AIza…",
  hosts: PROVIDER_HOSTS.gemini,
  canCancel: false,

  async validateKey(key, signal): Promise<KeyInfo> {
    await requestJson(`${API}/models?pageSize=1`, {
      headers: auth(key),
      signal,
    });
    return {};
  },

  async listModels(key, signal): Promise<VideoModel[]> {
    const models: GeminiModel[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${API}/models`);
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data: { models?: GeminiModel[]; nextPageToken?: string } =
        await requestJson(url.toString(), { headers: auth(key), signal });
      models.push(...(data.models ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return models.filter(isVideoModel).map(normalizeModel);
  },

  async submit(key, req, signal): Promise<JobRef> {
    const operation = await requestJson<{ name: string }>(
      `${API}/models/${encodeURIComponent(req.model)}:predictLongRunning`,
      jsonInit(auth(key), buildBody(req), signal),
    );
    return {
      provider: "gemini",
      id: operation.name,
      model: req.model,
      submittedAt: Date.now(),
    };
  },

  async *watch(key, job, signal): AsyncGenerator<JobEvent> {
    let announced = false;
    for (;;) {
      const operation = await requestJson<GeminiOperation>(`${API}/${job.id}`, {
        headers: auth(key),
        signal,
      });
      const at = Date.now();
      if (operation.done) {
        const video = operation.response?.generateVideoResponse;
        const uri = video?.generatedSamples?.[0]?.video?.uri;
        if (operation.error || !uri) {
          const reasons = video?.raiMediaFilteredReasons?.join(" ");
          yield {
            kind: "failed",
            at,
            error:
              operation.error?.message ?? reasons ?? "No video was returned",
            raw: operation,
          };
          return;
        }
        yield {
          kind: "completed",
          at,
          result: { videoUrl: uri },
          raw: operation,
        };
        return;
      }
      if (!announced) {
        announced = true;
        yield { kind: "status", at, status: "running", raw: operation };
      }
      await sleep(POLL_MS, signal);
    }
  },

  async fetchVideo(key, _job, result, signal): Promise<Blob> {
    if (!result.videoUrl) throw new ProviderError("No video URL to download");
    const response = await request(result.videoUrl, {
      headers: auth(key),
      signal,
    });
    return response.blob();
  },
};
