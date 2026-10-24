/** Shared plumbing for the provider adapters. */

export class ProviderError extends Error {
  readonly status?: number;
  readonly body?: unknown;

  constructor(
    message: string,
    options: { status?: number; body?: unknown } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.status = options.status;
    this.body = options.body;
  }

  /** 401/403: the key itself was rejected. */
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Pulls a human message out of the usual error envelopes. */
export function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 300);
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const error = record.error ?? record.detail ?? record.message;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const inner = error as Record<string, unknown>;
      if (typeof inner.message === "string") return inner.message;
    }
    if (Array.isArray(error) && error.length) {
      const first = error[0] as Record<string, unknown>;
      if (typeof first?.msg === "string") return first.msg;
    }
  }
  return fallback;
}

/** fetch() that turns non-2xx into a ProviderError with the server's message. */
export async function request(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, referrerPolicy: "no-referrer" });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ProviderError(
      `Could not reach ${new URL(url).host}: ${(error as Error).message}`,
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON; keep the text.
    }
    throw new ProviderError(
      errorMessage(body, `${response.status} ${response.statusText}`.trim()),
      { status: response.status, body },
    );
  }
  return response;
}

export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await request(url, init);
  return (await response.json()) as T;
}

export function jsonInit(
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): RequestInit {
  return {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  };
}

/** A pause that ends early when the signal aborts (rejecting like fetch does). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function isAbort(error: unknown): boolean {
  return (error as Error | undefined)?.name === "AbortError";
}

/** Splits a data URL into its media type and base64 payload. */
export function parseDataUrl(dataUrl: string): {
  mimeType: string;
  base64: string;
} {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new ProviderError("Image must be a base64 data URL");
  return { mimeType: match[1]!, base64: match[2]! };
}

/**
 * Bytes a provider sent inline as base64. Decoded here, not fetched as a
 * data: URL: the CSP's connect-src does not allow data:.
 */
export function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

const BASE64 = /^(?:data:[^;,]+;base64,)?[A-Za-z0-9+/=\s]+$/;
/** Strings shorter than this are left alone, even when they look like base64. */
const REDACT_OVER = 256;

/**
 * A payload with every long base64 string (inline image bytes) replaced by
 * a note of its size, so the raw events table stays readable.
 */
export function redactBase64<T>(value: T): T {
  if (typeof value === "string") {
    return (
      value.length > REDACT_OVER && BASE64.test(value)
        ? `<${value.length} characters of base64>`
        : value
    ) as T;
  }
  if (Array.isArray(value)) return value.map(redactBase64) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactBase64(v)]),
    ) as T;
  }
  return value;
}

/**
 * Reads a text/event-stream response, yielding each event's parsed `data`
 * JSON. Plain fetch (not EventSource) so the auth header can be sent.
 */
export async function* sse<T = unknown>(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const onAbort = () => reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
        const data = chunk
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) continue;
        try {
          yield JSON.parse(data) as T;
        } catch {
          // Not JSON (a comment or keep-alive): skip it.
        }
      }
    }
    if (signal?.aborted) throw abortError();
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
