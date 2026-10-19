import { useCallback, useState } from "react";
import type { ProviderId } from "@/providers/hosts";
import type { VideoModel } from "@/providers/types";
import * as settings from "./settings";

export interface Settings {
  provider: ProviderId | null;
  key: string | null;
  remember: boolean;
  /** The last-used model slug for the current provider. */
  model: string | null;
}

function load(provider = settings.getProvider()): Settings {
  return {
    provider,
    key: provider ? settings.getKey(provider) : null,
    remember: settings.getRemember(),
    model: provider ? settings.getLastModel(provider) : null,
  };
}

/** The remembered provider, key and model, kept in sync with storage. */
export function useSettings() {
  const [state, setState] = useState<Settings>(() => load());

  const chooseProvider = useCallback((provider: ProviderId) => {
    settings.setProvider(provider);
    setState(load(provider));
  }, []);

  const saveKey = useCallback(
    (provider: ProviderId, key: string, remember: boolean) => {
      settings.setRemember(remember);
      settings.setKey(provider, key, remember);
      setState(load(provider));
    },
    [],
  );

  const forgetKey = useCallback((provider: ProviderId) => {
    settings.forgetKey(provider);
    setState(load(provider));
  }, []);

  const chooseModel = useCallback((provider: ProviderId, model: string) => {
    settings.setLastModel(provider, model);
    setState(load(provider));
  }, []);

  const reset = useCallback(() => {
    settings.clearSettings();
    setState(load(null));
  }, []);

  return { ...state, chooseProvider, saveKey, forgetKey, chooseModel, reset };
}

/**
 * The full model record for a slug: from the cached list, or a bare record
 * for a slug typed by hand (the composer then shows free-form controls).
 */
export function resolveModel(provider: ProviderId, id: string): VideoModel {
  const cached = settings
    .getModelCache(provider)
    ?.models.find((model) => model.id === id);
  return cached ?? customModel(provider, id);
}

export function customModel(provider: ProviderId, id: string): VideoModel {
  return {
    provider,
    id,
    name: id,
    frameImages: ["first_frame"],
    referenceImages: true,
    audio: null,
    durations: null,
    resolutions: null,
    aspectRatios: null,
    sizes: null,
    pricing: null,
  };
}
