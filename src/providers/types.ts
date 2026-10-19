import type { ProviderId } from "./hosts";

export type { ProviderId };

export type FrameRole = "first_frame" | "last_frame";
export type ImageRole = FrameRole | "reference";

/** A provider's video model, normalised so the UI never sees provider shapes. */
export interface VideoModel {
  provider: ProviderId;
  /** The slug sent back to the provider. */
  id: string;
  name: string;
  description?: string;
  /** Frame images the model accepts; empty means text-only. */
  frameImages: FrameRole[];
  /** Whether loose reference images are accepted. */
  referenceImages: boolean;
  /** Whether the audio toggle is meaningful; null when unknown. */
  audio: boolean | null;
  /** Supported clip lengths in seconds; null when the model decides. */
  durations: number[] | null;
  resolutions: string[] | null;
  aspectRatios: string[] | null;
  /** Exact WIDTHxHEIGHT options, for models that take a size instead. */
  sizes: string[] | null;
  pricing: Pricing | null;
}

/** A price the UI can turn into an estimate, or a note when it cannot. */
export type Pricing =
  | { kind: "per-second"; rates: PerSecondRate[] }
  | { kind: "per-video"; usd: number }
  | { kind: "unknown"; note: string };

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
export interface VideoRequest {
  model: string;
  prompt: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  size?: string;
  audio?: boolean;
  images: ImageInput[];
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
  videoUrl?: string;
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

export interface VideoProvider {
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
  listModels(key: string, signal?: AbortSignal): Promise<VideoModel[]>;
  submit(key: string, req: VideoRequest, signal?: AbortSignal): Promise<JobRef>;
  /** Live progress until a `completed` or `failed` event; hides polling vs SSE. */
  watch(
    key: string,
    job: JobRef,
    signal: AbortSignal,
  ): AsyncGenerator<JobEvent>;
  fetchVideo(
    key: string,
    job: JobRef,
    result: JobResult,
    signal?: AbortSignal,
  ): Promise<Blob>;
  cancel?(key: string, job: JobRef): Promise<void>;
}
