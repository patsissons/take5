import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackupError,
  backupFileName,
  exportBackup,
  importBackup,
} from "./backup";
import {
  clearHistory,
  getMedia,
  getRun,
  listRuns,
  putMedia,
  putRun,
  resetDb,
  type Run,
} from "./history";

const run = (id: string, overrides: Partial<Run> = {}): Run => ({
  id,
  provider: "openrouter",
  modelName: "Veo",
  request: { model: "m", prompt: `prompt ${id}`, images: [] },
  status: "completed",
  createdAt: id.charCodeAt(0),
  ...overrides,
});

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  resetDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seed() {
  await putRun(run("a"));
  await putMedia("a", new Blob(["clip-a"], { type: "video/mp4" }));
  await putRun(run("b", { status: "failed", error: "nope" }));
  await putRun(run("c", { request: { ...run("c").request, kind: "image" } }));
  await putMedia("c", new Blob(["png-c!"], { type: "image/png" }));
  await putRun(
    run("d", {
      status: "running",
      job: { provider: "openrouter", id: "job-d", model: "m", submittedAt: 1 },
    }),
  );
}

describe("history file", () => {
  it("carries finished runs and their media to another device", async () => {
    await seed();
    const backup = await exportBackup();
    expect(backup.runs).toBe(3);
    expect(backup.bytes).toBe(backup.blob.size);

    await clearHistory();
    expect(await importBackup(backup.blob)).toEqual({ added: 3, skipped: 0 });
    expect((await listRuns()).map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(await getRun("b")).toMatchObject({ status: "failed" });
    expect(await getRun("d")).toBeUndefined();
    const a = await getMedia("a");
    expect(a?.type).toBe("video/mp4");
    expect(await a?.text()).toBe("clip-a");
    expect(await (await getMedia("c"))?.text()).toBe("png-c!");
  });

  it("never carries a running job's ref", async () => {
    await putRun(
      run("a", {
        job: {
          provider: "openrouter",
          id: "job-a",
          model: "m",
          submittedAt: 1,
        },
      }),
    );
    const backup = await exportBackup();
    await clearHistory();
    await importBackup(backup.blob);
    expect(await getRun("a")).not.toHaveProperty("job");
  });

  it("skips runs this device already has", async () => {
    await seed();
    const backup = await exportBackup();
    await putRun(run("a", { modelName: "kept" }));
    expect(await importBackup(backup.blob)).toEqual({ added: 0, skipped: 3 });
    expect(await getRun("a")).toMatchObject({ modelName: "kept" });
  });

  it("refuses files that aren't take5 history", async () => {
    await expect(
      importBackup(new Blob(["hello world, not it"])),
    ).rejects.toThrow(BackupError);
    const backup = await exportBackup();
    const bytes = new Uint8Array(await backup.blob.arrayBuffer());
    bytes[8] = 9;
    await expect(importBackup(new Blob([bytes]))).rejects.toThrow(/newer/);
    const cut = backup.blob.slice(0, 20);
    await expect(importBackup(cut)).rejects.toThrow(/damaged/);
  });

  it("refuses a history that won't fit in this browser", async () => {
    await seed();
    const backup = await exportBackup();
    await clearHistory();
    vi.stubGlobal("navigator", {
      storage: { estimate: () => Promise.resolve({ usage: 95, quota: 100 }) },
    });
    await expect(importBackup(backup.blob)).rejects.toThrow(/only has/);
    expect(await listRuns()).toEqual([]);
  });

  it("names the file after the day", () => {
    expect(backupFileName(new Date(2026, 9, 4))).toBe(
      "take5-history-2026-10-04.take5",
    );
  });
});
