import type { ProviderId } from "./hosts";
import { openrouter } from "./openrouter";
import type { VideoProvider } from "./types";

/** Every provider the app can talk to, in the order the setup card shows. */
export const providers: readonly VideoProvider[] = [openrouter];

export function providerById(id: ProviderId): VideoProvider | undefined {
  return providers.find((provider) => provider.id === id);
}
