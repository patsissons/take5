import { useCallback, useEffect, useRef, useState } from "react";
import { isAbort } from "@/providers/http";
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
      } catch (error) {
        if (isAbort(error)) return;
        const message = (error as Error).message || "Something went wrong";
        await history.putRun({
          ...run,
          status: "failed",
          finishedAt: Date.now(),
          error: message,
          job: undefined,
        });
        update({ status: "failed", error: message });
      }
    },
    [provider, key, update, replaceUrl],
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
        if (isAbort(error)) return;
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
