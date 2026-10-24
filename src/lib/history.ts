import type { JobRef, MediaRequest } from "@/providers/types";
import type { ProviderId } from "@/providers/hosts";

/**
 * Past and in-flight runs, with their videos, in IndexedDB. Every call
 * tolerates a missing or broken database: the app then simply has no
 * history.
 */
const DB_NAME = "take5";
const DB_VERSION = 1;

export type RunStatus = "running" | "completed" | "failed";

export interface Run {
  id: string;
  provider: ProviderId;
  modelName: string;
  request: MediaRequest;
  status: RunStatus;
  createdAt: number;
  finishedAt?: number;
  /** Kept while running so a reload can resume watching. */
  job?: JobRef;
  costUsd?: number;
  error?: string;
  /** A JPEG data URL of the first frame. */
  thumbnail?: string;
  videoBytes?: number;
  videoType?: string;
}

let dbPromise: Promise<IDBDatabase | null> | undefined;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("runs")) {
          db.createObjectStore("runs", { keyPath: "id" }).createIndex(
            "createdAt",
            "createdAt",
          );
        }
        if (!db.objectStoreNames.contains("videos")) {
          db.createObjectStore("videos");
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(null);
      open.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** For tests: forget the cached connection. */
export function resetDb(): void {
  dbPromise = undefined;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  name: "runs" | "videos",
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
  fallback: T,
): Promise<T> {
  const db = await openDb();
  if (!db) return fallback;
  try {
    const transaction = db.transaction(name, mode);
    const result = (await done(fn(transaction.objectStore(name)))) as T;
    // A write only survives a reload once its transaction has committed.
    if (mode === "readwrite") await committed(transaction);
    return result;
  } catch {
    return fallback;
  }
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Videos are stored as bytes + type: an ArrayBuffer clones everywhere. */
interface StoredVideo {
  type: string;
  bytes: ArrayBuffer;
}

export function newRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function putRun(run: Run): Promise<void> {
  return withStore("runs", "readwrite", (store) => store.put(run), undefined);
}

export function getRun(id: string): Promise<Run | undefined> {
  return withStore("runs", "readonly", (store) => store.get(id), undefined);
}

/** Newest first. */
export async function listRuns(): Promise<Run[]> {
  const runs = await withStore<Run[]>(
    "runs",
    "readonly",
    (store) => store.getAll(),
    [],
  );
  return runs.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteRun(id: string): Promise<void> {
  await withStore("runs", "readwrite", (store) => store.delete(id), undefined);
  await withStore(
    "videos",
    "readwrite",
    (store) => store.delete(id),
    undefined,
  );
}

export async function putMedia(id: string, blob: Blob): Promise<void> {
  const stored: StoredVideo = {
    type: blob.type,
    bytes: await blob.arrayBuffer(),
  };
  await withStore(
    "videos",
    "readwrite",
    (store) => store.put(stored, id),
    undefined,
  );
}

export async function getMedia(id: string): Promise<Blob | undefined> {
  const stored = await withStore<StoredVideo | undefined>(
    "videos",
    "readonly",
    (store) => store.get(id),
    undefined,
  );
  return stored ? new Blob([stored.bytes], { type: stored.type }) : undefined;
}

export async function clearHistory(): Promise<void> {
  await withStore("runs", "readwrite", (store) => store.clear(), undefined);
  await withStore("videos", "readwrite", (store) => store.clear(), undefined);
}

/** Drops the whole database (used by "Delete everything"). */
export async function deleteDatabase(): Promise<void> {
  const db = await openDb();
  db?.close();
  resetDb();
  await new Promise<void>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function storageEstimate(): Promise<{
  usage: number;
  quota: number;
} | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate) return null;
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}

/** The download name for a run's video. */
export function mediaFileName(run: Run): string {
  const ext = run.videoType?.includes("webm") ? "webm" : "mp4";
  return `take5-${run.id}.${ext}`;
}
