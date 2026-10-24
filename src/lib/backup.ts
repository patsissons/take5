import {
  getMedia,
  getRun,
  listRuns,
  putMedia,
  putRun,
  storageEstimate,
  type Run,
} from "./history";
import { formatBytes } from "./use-history";

/**
 * The history file a handoff sends alongside the QR: finished runs and
 * their media, never a key, so it is safe to pass through AirDrop, mail or
 * a cloud drive. Layout: magic ‖ u32 version ‖ u32 manifest length ‖
 * manifest JSON ‖ every media file's bytes back to back.
 */
const MAGIC = "TAKE5BAK";
const VERSION = 1;
const HEADER_BYTES = MAGIC.length + 8;

interface Manifest {
  v: number;
  exportedAt: number;
  runs: Run[];
  media: Array<{ id: string; type: string; offset: number; length: number }>;
}

export interface Backup {
  blob: Blob;
  runs: number;
  bytes: number;
}

/** Finished runs (all, or just the chosen ids) with their media, as one file. */
export async function exportBackup(ids?: ReadonlySet<string>): Promise<Backup> {
  const runs = (await listRuns())
    .filter((run) => run.status !== "running" && (!ids || ids.has(run.id)))
    .map(({ job: _job, ...run }) => run);
  const media: Manifest["media"] = [];
  const parts: Blob[] = [];
  let offset = 0;
  for (const run of runs) {
    const blob = await getMedia(run.id);
    if (!blob) continue;
    media.push({ id: run.id, type: blob.type, offset, length: blob.size });
    parts.push(blob);
    offset += blob.size;
  }
  const manifest: Manifest = {
    v: VERSION,
    exportedAt: Date.now(),
    runs,
    media,
  };
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  const header = new Uint8Array(HEADER_BYTES);
  header.set(new TextEncoder().encode(MAGIC));
  const view = new DataView(header.buffer);
  view.setUint32(MAGIC.length, VERSION, true);
  view.setUint32(MAGIC.length + 4, json.length, true);
  const blob = new Blob([header, json, ...parts], {
    type: "application/octet-stream",
  });
  return { blob, runs: runs.length, bytes: blob.size };
}

export class BackupError extends Error {}

/**
 * Adds a history file's runs to this device, skipping any it already has.
 * Media is read one slice at a time, so a phone never holds the whole file.
 */
export async function importBackup(
  file: Blob,
): Promise<{ added: number; skipped: number }> {
  const { manifest, base } = await readManifest(file);
  const fresh: Run[] = [];
  for (const run of manifest.runs) {
    if (await getRun(run.id)) continue;
    fresh.push(run);
  }
  const wanted = new Set(fresh.map((run) => run.id));
  const media = manifest.media.filter((entry) => wanted.has(entry.id));
  const needed = media.reduce((total, entry) => total + entry.length, 0);
  const estimate = await storageEstimate();
  if (estimate && estimate.quota > 0) {
    const free = estimate.quota - estimate.usage;
    if (needed > free) {
      throw new BackupError(
        `This history needs ${formatBytes(needed)} but the browser only has ${formatBytes(free)} free here.`,
      );
    }
  }
  for (const entry of media) {
    const start = base + entry.offset;
    await putMedia(
      entry.id,
      file.slice(start, start + entry.length, entry.type),
    );
  }
  // Runs last: a run never shows in the gallery before its media is in.
  for (const run of fresh) await putRun(run);
  return { added: fresh.length, skipped: manifest.runs.length - fresh.length };
}

async function manifestLength(file: Blob): Promise<number> {
  const header = new Uint8Array(
    await file.slice(0, HEADER_BYTES).arrayBuffer(),
  );
  if (
    header.length < HEADER_BYTES ||
    new TextDecoder().decode(header.slice(0, MAGIC.length)) !== MAGIC
  ) {
    throw new BackupError("That isn't a take5 history file.");
  }
  const view = new DataView(header.buffer);
  if (view.getUint32(MAGIC.length, true) !== VERSION) {
    throw new BackupError(
      "That history file comes from a newer take5; reload and try again.",
    );
  }
  return view.getUint32(MAGIC.length + 4, true);
}

/** The manifest, and where the media bytes start. */
async function readManifest(
  file: Blob,
): Promise<{ manifest: Manifest; base: number }> {
  const length = await manifestLength(file);
  try {
    const text = await file.slice(HEADER_BYTES, HEADER_BYTES + length).text();
    const manifest = JSON.parse(text) as Manifest;
    if (!Array.isArray(manifest.runs) || !Array.isArray(manifest.media)) {
      throw new Error("bad manifest");
    }
    return { manifest, base: HEADER_BYTES + length };
  } catch {
    throw new BackupError("That history file is damaged.");
  }
}

/** `take5-history-2026-10-24.take5` */
export function backupFileName(now = new Date()): string {
  const day = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `take5-history-${day}.take5`;
}
