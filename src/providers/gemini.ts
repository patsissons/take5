import { PROVIDER_HOSTS } from "./hosts";
import {
  base64ToBlob,
  jsonInit,
  parseDataUrl,
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
  TerminalEvent,
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

/** POST v1beta/models/{id}:generateContent, for an image model. */
export interface GeminiContentResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
        thought?: boolean;
        inlineData?: { mimeType?: string; data?: string };
      }>;
    };
  }>;
  promptFeedback?: { blockReason?: string };
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

export function normalizeModel(model: GeminiModel): MediaModel {
  const id = model.name.replace(/^models\//, "");
  const lite = /lite/.test(id);
  return {
    provider: "gemini",
    kind: "video",
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

/** Image models answer generateContent; Imagen (predict) has been shut down. */
export function isImageModel(model: GeminiModel): boolean {
  return (
    /image|nano-banana/i.test(model.name) &&
    !/imagen/i.test(model.name) &&
    (model.supportedGenerationMethods ?? []).includes("generateContent")
  );
}

/** USD per output image by size, from the Gemini pricing page. */
export function imagePricingFor(id: string): Pricing | null {
  const rate = (usd: Record<string, number>): Pricing => ({
    kind: "per-image",
    rates: Object.entries(usd).map(([resolution, cost]) => ({
      resolution,
      usd: cost,
    })),
  });
  if (/nano-banana-2\.1/.test(id))
    return rate({ "1K": 0.0336, "2K": 0.0504, "4K": 0.113 });
  if (/3\.1-flash-lite-image/.test(id)) return rate({ "1K": 0.0336 });
  if (/3\.1-flash-image/.test(id))
    return rate({ "512": 0.045, "1K": 0.067, "2K": 0.101, "4K": 0.151 });
  if (/3-pro-image/.test(id))
    return rate({ "1K": 0.134, "2K": 0.134, "4K": 0.24 });
  if (/2\.5-flash-image/.test(id))
    return { kind: "per-image", rates: [{ usd: 0.039 }] };
  return null;
}

/** imageSize values (uppercase K; 512 only on 3.1 Flash Image). */
function imageSizes(id: string): string[] | null {
  if (/lite|2\.5-flash-image/.test(id)) return null;
  if (/3\.1-flash-image/.test(id)) return ["512", "1K", "2K", "4K"];
  return ["1K", "2K", "4K"];
}

export function normalizeImageModel(model: GeminiModel): MediaModel {
  const id = model.name.replace(/^models\//, "");
  return {
    provider: "gemini",
    kind: "image",
    id,
    name: model.displayName ?? id,
    description: model.description,
    frameImages: [],
    referenceImages: true,
    maxImages: 14,
    audio: null,
    durations: null,
    resolutions: imageSizes(id),
    aspectRatios: [
      "1:1",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9",
    ],
    sizes: null,
    pricing: imagePricingFor(id),
  };
}

export function buildImageBody(req: MediaRequest): Record<string, unknown> {
  const imageConfig: Record<string, string> = {};
  if (req.aspectRatio) imageConfig.aspectRatio = req.aspectRatio;
  if (req.resolution) imageConfig.imageSize = req.resolution;
  return {
    contents: [
      {
        role: "user",
        parts: [
          ...req.images.map((image) => inline(image.dataUrl)),
          { text: req.prompt },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
    },
  };
}

/**
 * The image (the last one that is not a thought), or the provider's reason
 * for not making one: a finish reason like IMAGE_SAFETY, a blocked prompt,
 * or whatever the model said instead.
 */
export function imageAnswer(response: GeminiContentResponse): TerminalEvent {
  const at = Date.now();
  const raw = redactBase64(response);
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const image = parts
    .filter((part) => part.inlineData?.data && !part.thought)
    .at(-1)?.inlineData;
  if (image?.data) {
    return {
      kind: "completed",
      at,
      result: {
        media: base64ToBlob(image.data, image.mimeType ?? "image/png"),
      },
      raw,
    };
  }
  const said = parts
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text!.trim())
    .join(" ");
  const reason =
    response.promptFeedback?.blockReason ??
    (candidate?.finishReason && candidate.finishReason !== "STOP"
      ? candidate.finishReason
      : undefined);
  return {
    kind: "failed",
    at,
    error: reason ?? (said || "No image was returned"),
    raw,
  };
}

function inline(dataUrl: string) {
  const { mimeType, base64 } = parseDataUrl(dataUrl);
  return { inlineData: { mimeType, data: base64 } };
}

export function buildBody(req: MediaRequest): Record<string, unknown> {
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

export const gemini: MediaProvider = {
  id: "gemini",
  label: "Gemini",
  keyUrl: "https://aistudio.google.com/app/apikey",
  keyHint: "AIza…",
  hosts: PROVIDER_HOSTS.gemini,
  kinds: ["video", "image"],
  // generateContent answers with the image inline.
  answersAtSubmit: ["image"],
  canCancel: false,

  async validateKey(key, signal): Promise<KeyInfo> {
    await requestJson(`${API}/models?pageSize=1`, {
      headers: auth(key),
      signal,
    });
    return {};
  },

  async listModels(key, kind, signal): Promise<MediaModel[]> {
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
    return kind === "image"
      ? models.filter(isImageModel).map(normalizeImageModel)
      : models.filter(isVideoModel).map(normalizeModel);
  },

  async submit(key, req, signal): Promise<JobRef> {
    if (req.kind === "image") {
      const response = await requestJson<GeminiContentResponse>(
        `${API}/models/${encodeURIComponent(req.model)}:generateContent`,
        jsonInit(auth(key), buildImageBody(req), signal),
      );
      return {
        provider: "gemini",
        id: `image-${Date.now().toString(36)}`,
        model: req.model,
        submittedAt: Date.now(),
        answer: imageAnswer(response),
      };
    }
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
          result: { mediaUrl: uri },
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

  async fetchMedia(key, _job, result, signal): Promise<Blob> {
    if (!result.mediaUrl) throw new ProviderError("No video URL to download");
    const response = await request(result.mediaUrl, {
      headers: auth(key),
      signal,
    });
    return response.blob();
  },
};
