import type { ProviderId } from "./hosts";

export type { ProviderId };

/** What a run makes: a clip or a single still. */
export type MediaKind = "video" | "image";

export type FrameRole = "first_frame" | "last_frame";
export type ImageRole = FrameRole | "reference";

/** A provider's video or image model, normalised so the UI never sees provider shapes. */
export interface MediaModel {
  provider: ProviderId;
  kind: MediaKind;
  /** The slug sent back to the provider. */
  id: string;
  name: string;
  description?: string;
  /** Frame images the model accepts; empty means text-only. */
  frameImages: FrameRole[];
  /** Whether loose reference images are accepted. */
  referenceImages: boolean;
  /** The most input images the model takes, when it says. */
  maxImages?: number;
  /** Edit-only models: nothing runs without an input image. */
  imageRequired?: boolean;
  /** Whether the audio toggle is meaningful; null when unknown. */
  audio: boolean | null;
  /** Supported clip lengths in seconds; null when the model decides. */
  durations: number[] | null;
  resolutions: string[] | null;
  aspectRatios: string[] | null;
  /** Exact WIDTHxHEIGHT options, for models that take a size instead. */
  sizes: string[] | null;
  pricing: Pricing | null;
  /** Provider-specific details the adapter needs back at submit time. */
  extra?: Record<string, string>;
}

/** A price the UI can turn into an estimate, or a note when it cannot. */
export type Pricing =
  | { kind: "per-second"; rates: PerSecondRate[] }
  | { kind: "per-video"; usd: number }
  | { kind: "per-image"; rates: PerImageRate[] }
  | { kind: "per-megapixel"; usd: number }
  | { kind: "unknown"; note: string };

export interface PerImageRate {
  usd: number;
  /** Narrowing condition; undefined matches any resolution. */
  resolution?: string;
}

export interface PerSecondRate {
  usdPerSecond: number;
  /** Narrowing conditions; undefined matches anything. */
  resolution?: string;
  audio?: boolean;
  imageInput?: boolean;
}

export interface ImageInput {
  role: ImageRole;
  /** A data URL, produced in the browser; it is sent inline to the provider. */
  dataUrl: string;
}

/** What the visitor asked for, in provider-neutral terms. */
export interface MediaRequest {
  /** Undefined for runs made before images existed: a video. */
  kind?: MediaKind;
  model: string;
  prompt: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  size?: string;
  audio?: boolean;
  images: ImageInput[];
  /** The chosen model's `extra`, echoed so the adapter has it at submit time. */
  extra?: Record<string, string>;
}

/** Enough to find a submitted job again after a reload. */
export interface JobRef {
  provider: ProviderId;
  id: string;
  model: string;
  submittedAt: number;
  /** Provider-specific extras (fal's URLs, Gemini's operation name…). */
  extra?: Record<string, string>;
}

export type JobStatus =
  "submitted" | "queued" | "running" | "completed" | "failed" | "cancelled";

export interface JobResult {
  costUsd?: number;
  /** Where the provider put the video, when it is a URL we can fetch. */
  mediaUrl?: string;
}

/** One entry in the live timeline. `raw` is the provider payload, for the feed. */
export type JobEvent =
  | {
      kind: "status";
      at: number;
      status: JobStatus;
      queuePosition?: number;
      detail?: string;
      raw?: unknown;
    }
  | { kind: "log"; at: number; message: string; raw?: unknown }
  | { kind: "completed"; at: number; result: JobResult; raw?: unknown }
  | { kind: "failed"; at: number; error: string; raw?: unknown };

export interface KeyInfo {
  label?: string;
  /** Remaining credit in USD, when the provider reports it. */
  remainingUsd?: number | null;
}

export interface MediaProvider {
  id: ProviderId;
  label: string;
  /** Where to create an API key. */
  keyUrl: string;
  /** What a key looks like, for the input placeholder. */
  keyHint: string;
  /** Every host the adapter may contact (src/providers/hosts.ts). */
  hosts: readonly string[];
  /** Whether cancel() stops the job at the provider (otherwise we only stop watching). */
  canCancel: boolean;
  validateKey(key: string, signal?: AbortSignal): Promise<KeyInfo>;
  listModels(key: string, signal?: AbortSignal): Promise<MediaModel[]>;
  /** Fills in capabilities and pricing for one model when the list has none. */
  inspectModel?(
    key: string,
    model: MediaModel,
    signal?: AbortSignal,
  ): Promise<MediaModel>;
  submit(key: string, req: MediaRequest, signal?: AbortSignal): Promise<JobRef>;
  /** Live progress until a `completed` or `failed` event; hides polling vs SSE. */
  watch(
    key: string,
    job: JobRef,
    signal: AbortSignal,
  ): AsyncGenerator<JobEvent>;
  fetchMedia(
    key: string,
    job: JobRef,
    result: JobResult,
    signal?: AbortSignal,
  ): Promise<Blob>;
  cancel?(key: string, job: JobRef): Promise<void>;
}
