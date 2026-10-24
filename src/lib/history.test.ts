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
  newRunId,
  putRun,
  putMedia,
  resetDb,
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
