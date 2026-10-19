import { useCallback, useEffect, useRef, useState } from "react";
import { isAbort, ProviderError, sleep } from "@/providers/http";
import type {
  JobEvent,
  JobStatus,
  VideoModel,
  VideoProvider,
  VideoRequest,
} from "@/providers/types";
import * as history from "./history";
import { captureThumbnail } from "./thumbnail";

export interface RunState {
  run: history.Run;
  events: JobEvent[];
  status: JobStatus;
  queuePosition?: number;
  error?: string;
  /** An object URL for the finished video. */
  videoUrl?: string;
  blob?: Blob;
}

const TERMINAL: JobStatus[] = ["completed", "failed", "cancelled"];

/**
 * Set while the page is unloading. A navigation cancels in-flight fetches
 * with a network error (not an AbortError); without this guard the watcher
 * would record the run as failed and lose the job it should resume later.
 */
let unloading = false;
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    unloading = true;
  });
  window.addEventListener("beforeunload", () => {
    unloading = true;
  });
}

function ignorable(error: unknown): boolean {
  return isAbort(error) || unloading;
}

/** A failure to reach the provider at all, as opposed to an answer from it. */
function isNetworkError(error: unknown): boolean {
  return error instanceof ProviderError && error.status === undefined;
}

export const RETRY_LIMIT = 5;
export const RETRY_MS = 3000;

export function isFinished(status: JobStatus): boolean {
  return TERMINAL.includes(status);
}

/**
 * Drives one generation at a time: submit, watch the provider's events,
 * download the result, and keep history up to date throughout so a reload
 * can pick the job back up.
 */
export function useRun(
  provider: VideoProvider | undefined,
  key: string | null,
  { retryMs = RETRY_MS }: { retryMs?: number } = {},
) {
  const [current, setCurrent] = useState<RunState | null>(null);
  const controller = useRef<AbortController | null>(null);
  const urlRef = useRef<string | undefined>(undefined);

  const update = useCallback(
    (patch: Partial<RunState> | ((s: RunState) => RunState)) => {
      setCurrent((state) =>
        state
          ? typeof patch === "function"
            ? patch(state)
            : { ...state, ...patch }
          : state,
      );
    },
    [],
  );

  const replaceUrl = useCallback((blob: Blob | undefined) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = blob ? URL.createObjectURL(blob) : undefined;
    return urlRef.current;
  }, []);

  useEffect(
    () => () => {
      replaceUrl(undefined);
    },
    [replaceUrl],
  );

  const watch = useCallback(
    async (run: history.Run, signal: AbortSignal) => {
      if (!provider || !key || !run.job) return;
      const push = (event: JobEvent) =>
        update((state) => ({
          ...state,
          events: [...state.events, event],
          ...(event.kind === "status"
            ? { status: event.status, queuePosition: event.queuePosition }
            : {}),
        }));
      // A lost connection is not a failed job: retry a few times before
      // giving up, and never record anything while the page is unloading.
      for (let attempt = 0; ; attempt++) {
        try {
          for await (const event of provider.watch(key, run.job, signal)) {
            push(event);
            if (event.kind === "failed") {
              await history.putRun({
                ...run,
                status: "failed",
                finishedAt: event.at,
                error: event.error,
                job: undefined,
              });
              update({ status: "failed", error: event.error });
              return;
            }
            if (event.kind === "completed") {
              update({ status: "running" });
              const blob = await provider.fetchVideo(
                key,
                run.job,
                event.result,
                signal,
              );
              const thumbnail = await captureThumbnail(blob);
              const finished: history.Run = {
                ...run,
                status: "completed",
                finishedAt: Date.now(),
                costUsd: event.result.costUsd,
                thumbnail,
                videoBytes: blob.size,
                videoType: blob.type,
                job: undefined,
              };
              await history.putVideo(run.id, blob);
              await history.putRun(finished);
              update({
                run: finished,
                status: "completed",
                blob,
                videoUrl: replaceUrl(blob),
              });
              return;
            }
          }
          return;
        } catch (error) {
          if (ignorable(error)) return;
          const message = (error as Error).message || "Something went wrong";
          if (isNetworkError(error) && attempt < RETRY_LIMIT) {
            push({
              kind: "log",
              at: Date.now(),
              message: `${message}; retrying…`,
            });
            try {
              await sleep(retryMs, signal);
            } catch {
              return;
            }
            continue;
          }
          await history.putRun({
            ...run,
            status: "failed",
            finishedAt: Date.now(),
            error: message,
            job: undefined,
          });
          update({ status: "failed", error: message });
          return;
        }
      }
    },
    [provider, key, update, replaceUrl, retryMs],
  );

  const start = useCallback(
    async (req: VideoRequest, model: VideoModel) => {
      if (!provider || !key) return;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      replaceUrl(undefined);
      const run: history.Run = {
        id: history.newRunId(),
        provider: provider.id,
        modelName: model.name,
        request: req,
        status: "running",
        createdAt: Date.now(),
      };
      setCurrent({ run, events: [], status: "submitted" });
      try {
        const job = await provider.submit(key, req, abort.signal);
        const submitted = { ...run, job };
        await history.putRun(submitted);
        update((state) => ({
          ...state,
          run: submitted,
          events: [
            { kind: "status", at: Date.now(), status: "submitted", raw: job },
          ],
        }));
        await watch(submitted, abort.signal);
      } catch (error) {
        if (ignorable(error)) return;
        const message = (error as Error).message || "Could not submit the job";
        update({ status: "failed", error: message });
      }
    },
    [provider, key, update, watch, replaceUrl],
  );

  /** Picks up a run that was in flight when the page was last closed. */
  const resume = useCallback(
    async (run: history.Run) => {
      if (!run.job) return;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      replaceUrl(undefined);
      setCurrent({
        run,
        events: [{ kind: "status", at: run.createdAt, status: "submitted" }],
        status: "queued",
      });
      await watch(run, abort.signal);
    },
    [watch, replaceUrl],
  );

  /** Shows a finished run from history again. */
  const show = useCallback(
    async (run: history.Run) => {
      controller.current?.abort();
      const blob = await history.getVideo(run.id);
      setCurrent({
        run,
        events: [],
        status: run.status === "completed" ? "completed" : "failed",
        error: run.error,
        blob,
        videoUrl: replaceUrl(blob),
      });
    },
    [replaceUrl],
  );

  const cancel = useCallback(async () => {
    const state = current;
    controller.current?.abort();
    if (!state || isFinished(state.status)) return;
    if (provider?.cancel && key && state.run.job) {
      await provider.cancel(key, state.run.job).catch(() => undefined);
    }
    await history.putRun({
      ...state.run,
      status: "failed",
      finishedAt: Date.now(),
      error: provider?.canCancel ? "Cancelled" : "Stopped watching",
      job: undefined,
    });
    update({ status: "cancelled" });
  }, [current, provider, key, update]);

  const clear = useCallback(() => {
    controller.current?.abort();
    replaceUrl(undefined);
    setCurrent(null);
  }, [replaceUrl]);

  return { current, start, resume, show, cancel, clear };
}
