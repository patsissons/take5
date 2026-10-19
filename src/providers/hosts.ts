/**
 * Every host the app may contact, per provider. This is the single source for
 * the Content-Security-Policy (scripts/headers.ts writes it into
 * public/_headers), the Privacy page and the e2e allowlist check: a host
 * that is not listed here is blocked by the browser itself.
 *
 * Runtime-agnostic (no DOM): scripts/headers.ts imports it under Node.
 */
export type ProviderId = "openrouter" | "fal" | "gemini" | "xai";

export const PROVIDER_HOSTS: Record<ProviderId, readonly string[]> = {
  openrouter: ["openrouter.ai"],
  fal: ["api.fal.ai", "queue.fal.run"],
  gemini: ["generativelanguage.googleapis.com"],
  xai: ["api.x.ai"],
};

/** Every host across all providers, deduplicated and sorted. */
export function allHosts(): string[] {
  return [...new Set(Object.values(PROVIDER_HOSTS).flat())].sort();
}
