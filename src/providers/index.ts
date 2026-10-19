import { fal } from "./fal";
import { gemini } from "./gemini";
import type { ProviderId } from "./hosts";
import { openrouter } from "./openrouter";
import type { VideoProvider } from "./types";
import { xai } from "./xai";

/** Every provider the app can talk to, in the order the setup card shows. */
export const providers: readonly VideoProvider[] = [
  openrouter,
  fal,
  gemini,
  xai,
];

export function providerById(id: ProviderId): VideoProvider | undefined {
  return providers.find((provider) => provider.id === id);
}
