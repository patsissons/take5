import type { ProviderId } from "@/providers/hosts";
import type { MediaKind, MediaModel } from "@/providers/types";

/**
 * Everything small the app remembers, in localStorage (or sessionStorage
 * for a key the visitor chose not to keep). Every access is guarded: the
 * app keeps working when storage is blocked, it just forgets on reload.
 */
const PREFIX = "take5:";

type Store = "local" | "session";

function storage(kind: Store): Storage | null {
  try {
    const store = kind === "local" ? localStorage : sessionStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

export function read(key: string, kind: Store = "local"): string | null {
  try {
    return storage(kind)?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export function write(key: string, value: string, kind: Store = "local"): void {
  try {
    storage(kind)?.setItem(PREFIX + key, value);
  } catch {
    // Quota or private mode: the value lasts for this page view only.
  }
}

export function remove(key: string, kind?: Store): void {
  for (const store of kind ? [kind] : (["local", "session"] as const)) {
    try {
      storage(store)?.removeItem(PREFIX + key);
    } catch {
      // Nothing to forget.
    }
  }
}

function readJson<T>(key: string): T | null {
  const raw = read(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const PROVIDER_IDS: readonly ProviderId[] = [
  "openrouter",
  "fal",
  "gemini",
  "xai",
];

export function getProvider(): ProviderId | null {
  const value = read("provider");
  return PROVIDER_IDS.includes(value as ProviderId)
    ? (value as ProviderId)
    : null;
}

export function setProvider(provider: ProviderId): void {
  write("provider", provider);
}

/** "Remember on this device": on by default. */
export function getRemember(): boolean {
  return read("remember") !== "false";
}

export function setRemember(remember: boolean): void {
  write("remember", String(remember));
}

export function getKey(provider: ProviderId): string | null {
  return read(`key:${provider}`) ?? read(`key:${provider}`, "session");
}

export function setKey(
  provider: ProviderId,
  key: string,
  remember: boolean,
): void {
  remove(`key:${provider}`);
  write(`key:${provider}`, key, remember ? "local" : "session");
}

export function forgetKey(provider: ProviderId): void {
  remove(`key:${provider}`);
}

/** Video or image: what the studio makes. Video until the visitor switches. */
export function getMode(): MediaKind {
  return read("mode") === "image" ? "image" : "video";
}

export function setMode(mode: MediaKind): void {
  write("mode", mode);
}

/**
 * Each mode remembers its own model and list. Video keeps the keys it had
 * before images existed, so nothing needs migrating.
 */
function modeKey(kind: MediaKind, name: "model" | "models"): string {
  return kind === "video" ? name : `image-${name}`;
}

export function getLastModel(
  provider: ProviderId,
  kind: MediaKind,
): string | null {
  return read(`${modeKey(kind, "model")}:${provider}`);
}

export function setLastModel(
  provider: ProviderId,
  model: string,
  kind: MediaKind,
): void {
  write(`${modeKey(kind, "model")}:${provider}`, model);
}

export interface ModelCache {
  at: number;
  models: MediaModel[];
}

export function getModelCache(
  provider: ProviderId,
  kind: MediaKind,
): ModelCache | null {
  const cache = readJson<ModelCache>(`${modeKey(kind, "models")}:${provider}`);
  if (!cache || !Array.isArray(cache.models)) return null;
  // Lists cached before models carried a kind are all videos.
  return {
    ...cache,
    models: cache.models.map((model) =>
      model.kind ? model : { ...model, kind },
    ),
  };
}

export function setModelCache(
  provider: ProviderId,
  models: MediaModel[],
  kind: MediaKind,
): void {
  write(
    `${modeKey(kind, "models")}:${provider}`,
    JSON.stringify({ at: Date.now(), models }),
  );
}

export function clearModelCache(provider: ProviderId, kind: MediaKind): void {
  remove(`${modeKey(kind, "models")}:${provider}`);
}

/** Forgets every setting and key (the theme choice included). */
export function clearSettings(): void {
  for (const kind of ["local", "session"] as const) {
    const store = storage(kind);
    if (!store) continue;
    try {
      const doomed: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const name = store.key(i);
        if (name?.startsWith(PREFIX)) doomed.push(name);
      }
      doomed.forEach((name) => store.removeItem(name));
    } catch {
      // Already gone, or blocked.
    }
  }
}
