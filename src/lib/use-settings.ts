import { useCallback, useState } from "react";
import type { ProviderId } from "@/providers/hosts";
import type { MediaKind, MediaModel } from "@/providers/types";
import * as settings from "./settings";

export interface Settings {
  provider: ProviderId | null;
  key: string | null;
  remember: boolean;
  /** Whether the studio makes videos or images. */
  mode: MediaKind;
  /** The last-used model slug for the current provider and mode. */
  model: string | null;
}

function load(provider = settings.getProvider()): Settings {
  const mode = settings.getMode();
  return {
    provider,
    key: provider ? settings.getKey(provider) : null,
    remember: settings.getRemember(),
    mode,
    model: provider ? settings.getLastModel(provider, mode) : null,
  };
}

/** The remembered provider, key, mode and model, kept in sync with storage. */
export function useSettings() {
  const [state, setState] = useState<Settings>(() => load());

  const chooseMode = useCallback((mode: MediaKind) => {
    settings.setMode(mode);
    setState((current) => load(current.provider));
  }, []);

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

  const chooseModel = useCallback(
    (provider: ProviderId, model: string, kind: MediaKind) => {
      settings.setLastModel(provider, model, kind);
      setState(load(provider));
    },
    [],
  );

  /** After something else (a handoff) wrote the settings. */
  const reload = useCallback(() => setState(load()), []);

  const reset = useCallback(() => {
    settings.clearSettings();
    setState(load(null));
  }, []);

  return {
    ...state,
    chooseProvider,
    chooseMode,
    saveKey,
    forgetKey,
    chooseModel,
    reload,
    reset,
  };
}

/**
 * The full model record for a slug: from the cached list, or a bare record
 * for a slug typed by hand (the composer then shows free-form controls).
 */
export function resolveModel(
  provider: ProviderId,
  id: string,
  kind: MediaKind,
): MediaModel {
  const cached = settings
    .getModelCache(provider, kind)
    ?.models.find((model) => model.id === id);
  return cached ?? customModel(provider, id, kind);
}

export function customModel(
  provider: ProviderId,
  id: string,
  kind: MediaKind = "video",
): MediaModel {
  return {
    provider,
    kind,
    id,
    name: id,
    frameImages: kind === "video" ? ["first_frame"] : [],
    referenceImages: true,
    audio: null,
    durations: null,
    resolutions: null,
    aspectRatios: null,
    sizes: null,
    pricing: null,
  };
}
