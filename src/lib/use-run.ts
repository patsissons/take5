import { useCallback, useEffect, useRef, useState } from "react";
import { isAbort, ProviderError, sleep } from "@/providers/http";
import type {
  JobEvent,
  JobRef,
  JobStatus,
  MediaModel,
  MediaProvider,
  MediaRequest,
  TerminalEvent,
} from "@/providers/types";
import * as history from "./history";
import { captureThumbnail } from "./thumbnail";

export interface RunState {
  run: history.Run;
  events: JobEvent[];
  status: JobStatus;
  queuePosition?: number;
  error?: string;
  /** An object URL for the finished video or image. */
  mediaUrl?: string;
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
  provider: MediaProvider | undefined,
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

  /** Records how a run ended: the failure, or the media and its thumbnail. */
  const settle = useCallback(
    async (
      run: history.Run,
      job: JobRef,
      event: TerminalEvent,
      signal: AbortSignal,
    ) => {
      if (!provider || !key) return;
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
      update({ status: "running" });
      const blob =
        event.result.media ??
        (await provider.fetchMedia(key, job, event.result, signal));
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
      await history.putMedia(run.id, blob);
      await history.putRun(finished);
      update({
        run: finished,
        status: "completed",
        blob,
        mediaUrl: replaceUrl(blob),
      });
    },
    [provider, key, update, replaceUrl],
  );

  const watch = useCallback(
    async (run: history.Run, signal: AbortSignal) => {
      if (!provider || !key || !run.job) return;
      const job = run.job;
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
          for await (const event of provider.watch(key, job, signal)) {
            push(event);
            if (event.kind === "failed" || event.kind === "completed") {
              await settle(run, job, event, signal);
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
    [provider, key, update, settle, retryMs],
  );

  const start = useCallback(
    async (req: MediaRequest, model: MediaModel) => {
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
      // A synchronous provider is generating from the moment it is asked.
      const synchronous = !!provider.answersAtSubmit?.includes(
        req.kind ?? "video",
      );
      setCurrent({
        run,
        events: [],
        status: synchronous ? "running" : "submitted",
      });
      try {
        const { answer, ...job } = await provider.submit(
          key,
          req,
          abort.signal,
        );
        const submitted = { kind: "status", status: "submitted" } as const;
        if (answer) {
          // Nothing to resume: the run is only stored once it has ended.
          update((state) => ({
            ...state,
            events: [{ ...submitted, at: run.createdAt, raw: job }, answer],
          }));
          await settle(run, job, answer, abort.signal);
          return;
        }
        const queued = { ...run, job };
        await history.putRun(queued);
        update((state) => ({
          ...state,
          run: queued,
          events: [{ ...submitted, at: Date.now(), raw: job }],
        }));
        await watch(queued, abort.signal);
      } catch (error) {
        if (ignorable(error)) return;
        const message = (error as Error).message || "Could not submit the job";
        update({ status: "failed", error: message });
      }
    },
    [provider, key, update, watch, settle, replaceUrl],
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
      const blob = await history.getMedia(run.id);
      setCurrent({
        run,
        events: [],
        status: run.status === "completed" ? "completed" : "failed",
        error: run.error,
        blob,
        mediaUrl: replaceUrl(blob),
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
