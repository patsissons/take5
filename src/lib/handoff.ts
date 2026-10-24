import type { ProviderId } from "@/providers/hosts";
import type { MediaKind } from "@/providers/types";
import * as settings from "./settings";

/**
 * Handoff: this device's setup, sealed into a link for a phone to open.
 * The link's `#handoff=` fragment never leaves the browser, and its
 * payload is AES-GCM encrypted with a short code the visitor types on the
 * phone, so a synced browser history never holds a usable key.
 */
export interface HandoffConfig {
  v: 1;
  /** Milliseconds since the epoch after which the phone refuses it. */
  exp: number;
  provider: ProviderId;
  mode: MediaKind;
  remember: boolean;
  keys: Partial<Record<ProviderId, string>>;
  models: Array<{ provider: ProviderId; kind: MediaKind; id: string }>;
  /** A history file is on its way too. */
  history: boolean;
}

export type HandoffOpen =
  | { ok: true; config: HandoffConfig }
  | { ok: false; reason: "code" | "expired" | "malformed" };

/** How long a sealed link stays good. */
export const HANDOFF_TTL_MS = 10 * 60_000;
export const HASH_PREFIX = "#handoff=";

const VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const ITERATIONS = 600_000;
const CODE_LENGTH = 8;
// Crockford base32: no I, L, O or U, so a typed code is hard to misread.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KINDS: readonly MediaKind[] = ["video", "image"];

/** This device's provider, keys and models; null until a provider is set. */
export function collectHandoff(history: boolean): HandoffConfig | null {
  const provider = settings.getProvider();
  if (!provider) return null;
  const keys: HandoffConfig["keys"] = {};
  const models: HandoffConfig["models"] = [];
  for (const id of settings.PROVIDER_IDS) {
    const key = settings.getKey(id);
    if (key) keys[id] = key;
    for (const kind of KINDS) {
      const model = settings.getLastModel(id, kind);
      if (model) models.push({ provider: id, kind, id: model });
    }
  }
  return {
    v: VERSION,
    exp: Date.now() + HANDOFF_TTL_MS,
    provider,
    mode: settings.getMode(),
    remember: settings.getRemember(),
    keys,
    models,
    history,
  };
}

/** Writes a handoff into this device's settings; other keys stay. */
export function applyHandoff(config: HandoffConfig): void {
  settings.setRemember(config.remember);
  for (const id of settings.PROVIDER_IDS) {
    const key = config.keys[id];
    if (key) settings.setKey(id, key, config.remember);
  }
  for (const model of config.models) {
    settings.setLastModel(model.provider, model.id, model.kind);
  }
  settings.setMode(config.mode);
  settings.setProvider(config.provider);
}

/** A fresh random code, eight characters (40 bits). */
export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (byte) => ALPHABET[byte % 32]).join("");
}

/** `ABCDEFGH` as `ABCD-EFGH`, easier to read off a screen. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** What was typed, as the code it means: case, spaces and dashes ignored. */
export function normalizeCode(typed: string): string {
  return typed
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function isCompleteCode(typed: string): boolean {
  const code = normalizeCode(typed);
  return (
    code.length === CODE_LENGTH &&
    [...code].every((char) => ALPHABET.includes(char))
  );
}

async function deriveKey(
  code: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalizeCode(code)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** version ‖ salt ‖ IV ‖ AES-GCM ciphertext, as base64url. */
export async function sealHandoff(
  config: HandoffConfig,
  code: string,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(code, salt);
  const plain = new TextEncoder().encode(JSON.stringify(config));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain),
  );
  const out = new Uint8Array(1 + SALT_BYTES + IV_BYTES + sealed.length);
  out[0] = VERSION;
  out.set(salt, 1);
  out.set(iv, 1 + SALT_BYTES);
  out.set(sealed, 1 + SALT_BYTES + IV_BYTES);
  return toBase64Url(out);
}

export async function openHandoff(
  sealed: string,
  code: string,
): Promise<HandoffOpen> {
  const bytes = fromBase64Url(sealed);
  if (
    !bytes ||
    bytes[0] !== VERSION ||
    bytes.length <= 1 + SALT_BYTES + IV_BYTES
  ) {
    return { ok: false, reason: "malformed" };
  }
  const salt = bytes.slice(1, 1 + SALT_BYTES);
  const iv = bytes.slice(1 + SALT_BYTES, 1 + SALT_BYTES + IV_BYTES);
  let plain: ArrayBuffer;
  try {
    const key = await deriveKey(code, salt);
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      bytes.slice(1 + SALT_BYTES + IV_BYTES),
    );
  } catch {
    // GCM's tag fails for a wrong code (and for tampered bytes).
    return { ok: false, reason: "code" };
  }
  let config: unknown;
  try {
    config = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isConfig(config)) return { ok: false, reason: "malformed" };
  if (Date.now() > config.exp) return { ok: false, reason: "expired" };
  return { ok: true, config };
}

/** The page's own address with the sealed payload in the fragment. */
export function handoffLink(sealed: string, location: Location): string {
  return `${location.origin}${location.pathname}${HASH_PREFIX}${sealed}`;
}

/** The sealed payload a `#handoff=` hash carries, if any. */
export function sealedFromHash(hash: string): string | null {
  return hash.startsWith(HASH_PREFIX)
    ? hash.slice(HASH_PREFIX.length) || null
    : null;
}

/** `sk-or-v1-abc…f3a2`: enough to recognise a key, not to use it. */
export function maskKey(key: string): string {
  return key.length <= 10 ? "••••" : `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function isProvider(value: unknown): value is ProviderId {
  return settings.PROVIDER_IDS.includes(value as ProviderId);
}

function isKind(value: unknown): value is MediaKind {
  return KINDS.includes(value as MediaKind);
}

function isConfig(value: unknown): value is HandoffConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<HandoffConfig>;
  return (
    config.v === VERSION &&
    typeof config.exp === "number" &&
    isProvider(config.provider) &&
    isKind(config.mode) &&
    typeof config.remember === "boolean" &&
    typeof config.history === "boolean" &&
    !!config.keys &&
    typeof config.keys === "object" &&
    Object.entries(config.keys).every(
      ([id, key]) => isProvider(id) && typeof key === "string",
    ) &&
    Array.isArray(config.models) &&
    config.models.every(
      (model) =>
        isProvider(model?.provider) &&
        isKind(model?.kind) &&
        typeof model?.id === "string",
    )
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
