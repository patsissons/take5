import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHistory,
  deleteDatabase,
  deleteRun,
  getRun,
  getMedia,
  listRuns,
  mediaFileName,
  newRunId,
  putRun,
  putMedia,
  resetDb,
  runKind,
  type Run,
} from "./history";

const run = (id: string, createdAt: number): Run => ({
  id,
  provider: "openrouter",
  modelName: "Veo",
  request: { model: "m", prompt: "p", images: [] },
  status: "completed",
  createdAt,
});

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  resetDb();
});

describe("history", () => {
  it("stores runs newest first and their videos", async () => {
    await putRun(run("a", 1));
    await putRun(run("b", 2));
    await putMedia("b", new Blob(["video"], { type: "video/mp4" }));
    expect((await listRuns()).map((r) => r.id)).toEqual(["b", "a"]);
    expect(await getRun("a")).toMatchObject({ modelName: "Veo" });
    expect((await getMedia("b"))?.size).toBe(5);
    expect(await getMedia("a")).toBeUndefined();
  });

  it("deletes a run with its video, and everything on clear", async () => {
    await putRun(run("a", 1));
    await putMedia("a", new Blob(["v"]));
    await deleteRun("a");
    expect(await getRun("a")).toBeUndefined();
    expect(await getMedia("a")).toBeUndefined();

    await putRun(run("b", 1));
    await clearHistory();
    expect(await listRuns()).toEqual([]);

    await putRun(run("c", 1));
    await deleteDatabase();
    expect(await listRuns()).toEqual([]);
  });

  it("names downloads by what was stored", () => {
    const a = run("a", 1);
    const still = { ...a, request: { ...a.request, kind: "image" as const } };
    expect(mediaFileName(a)).toBe("take5-a.mp4");
    expect(mediaFileName({ ...a, videoType: "video/webm" })).toBe(
      "take5-a.webm",
    );
    expect(mediaFileName({ ...still, videoType: "image/png" })).toBe(
      "take5-a.png",
    );
    expect(mediaFileName({ ...still, videoType: "image/jpeg" })).toBe(
      "take5-a.jpg",
    );
    expect(mediaFileName({ ...still, videoType: "image/webp" })).toBe(
      "take5-a.webp",
    );
    expect(mediaFileName(still)).toBe("take5-a.png");
  });

  it("reads runs from before stills as videos", () => {
    const a = run("a", 1);
    expect(runKind(a)).toBe("video");
    expect(runKind({ request: { ...a.request, kind: "image" } })).toBe("image");
  });

  it("keeps an image's bytes and type", async () => {
    await putMedia("a", new Blob(["png"], { type: "image/png" }));
    expect((await getMedia("a"))?.type).toBe("image/png");
  });

  it("makes unique ids", () => {
    expect(newRunId()).not.toBe(newRunId());
  });

  it("degrades to nothing without IndexedDB", async () => {
    vi.stubGlobal("indexedDB", undefined);
    resetDb();
    expect(await listRuns()).toEqual([]);
    await expect(putRun(run("a", 1))).resolves.toBeUndefined();
  });
});
