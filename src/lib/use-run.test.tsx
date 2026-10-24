import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/providers/http";
import type { JobEvent, MediaProvider } from "@/providers/types";
import { getRun, resetDb } from "./history";
import { customModel } from "./use-settings";
import { useRun } from "./use-run";

vi.mock("@/lib/thumbnail", () => ({ captureThumbnail: async () => undefined }));

function provider(watch: MediaProvider["watch"]): MediaProvider {
  return {
    id: "openrouter",
    label: "Fake",
    keyUrl: "",
    keyHint: "",
    hosts: [],
    canCancel: false,
    validateKey: vi.fn(),
    listModels: vi.fn(),
    submit: vi.fn(async () => ({
      provider: "openrouter" as const,
      id: "job",
      model: "m",
      submittedAt: 0,
    })),
    watch,
    fetchMedia: vi.fn(async () => new Blob(["v"], { type: "video/mp4" })),
  };
}

const req = { model: "m", prompt: "p", images: [] };
const model = customModel("openrouter", "m");

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  resetDb();
});

describe("useRun", () => {
  it("retries after a lost connection instead of failing the run", async () => {
    let calls = 0;
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const watch = vi.fn(async function* (): AsyncGenerator<JobEvent> {
      if (calls++ === 0)
        throw new ProviderError("Could not reach api: offline");
      await released;
      yield { kind: "completed", at: 1, result: { costUsd: 1 } };
    });
    const { result } = renderHook(() =>
      useRun(provider(watch), "k", { retryMs: 20 }),
    );
    act(() => {
      void result.current.start(req, model);
    });
    await waitFor(() =>
      expect(result.current.current?.events.at(-1)).toMatchObject({
        kind: "log",
        message: "Could not reach api: offline; retrying…",
      }),
    );
    expect(result.current.current?.status).toBe("submitted");
    // The job stays on record so a reload can resume it.
    expect((await getRun(result.current.current!.run.id))?.job).toBeDefined();

    await waitFor(() => expect(watch).toHaveBeenCalledTimes(2));
    release();
    await waitFor(() =>
      expect(result.current.current?.status).toBe("completed"),
    );
    expect((await getRun(result.current.current!.run.id))?.job).toBeUndefined();
  });

  it("records a provider's answer as a failure", async () => {
    // eslint-disable-next-line require-yield
    const watch = vi.fn(async function* (): AsyncGenerator<JobEvent> {
      throw new ProviderError("Not found", { status: 404 });
    });
    const { result } = renderHook(() => useRun(provider(watch), "k"));
    act(() => {
      void result.current.start(req, model);
    });
    await waitFor(() => expect(result.current.current?.status).toBe("failed"));
    expect(result.current.current?.error).toBe("Not found");
    expect((await getRun(result.current.current!.run.id))?.status).toBe(
      "failed",
    );
  });
});
