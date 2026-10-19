import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { badges } from "@/lib/model-badges";
import { getModelCache, setModelCache } from "@/lib/settings";
import { customModel } from "@/lib/use-settings";
import type { VideoModel, VideoProvider } from "@/providers/types";

interface Props {
  provider: VideoProvider;
  apiKey: string;
  selected?: string | null;
  onPick: (model: VideoModel) => void;
}

type Load =
  | { status: "loading"; models: VideoModel[]; at?: number }
  | { status: "ready"; models: VideoModel[]; at: number }
  | { status: "error"; models: VideoModel[]; at?: number; error: string };

/** The provider's video models, cached locally, searchable, or a slug typed by hand. */
export function ModelPicker({ provider, apiKey, selected, onPick }: Props) {
  const [load, setLoad] = useState<Load>(() => {
    const cache = getModelCache(provider.id);
    return cache
      ? { status: "ready", models: cache.models, at: cache.at }
      : { status: "loading", models: [] };
  });
  const [query, setQuery] = useState("");
  const [slug, setSlug] = useState("");
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);

  /**
   * Some providers (fal) describe a model's inputs and price only per
   * model: fetch that on pick, and keep it in the cache for next time.
   */
  const pick = async (model: VideoModel) => {
    if (!provider.inspectModel || inspecting) return onPick(model);
    setInspecting(model.id);
    setInspectError(null);
    try {
      const detailed = await provider.inspectModel(apiKey, model);
      // Written synchronously: the parent reads the cache as soon as onPick
      // runs, and a state updater would run too late for that.
      const models = load.models.some((m) => m.id === model.id)
        ? load.models.map((m) => (m.id === model.id ? detailed : m))
        : [...load.models, detailed];
      setModelCache(provider.id, models);
      setLoad((state) => ({ ...state, models }));
      onPick(detailed);
    } catch (error) {
      setInspectError((error as Error).message);
    } finally {
      setInspecting(null);
    }
  };

  const refresh = useCallback(async () => {
    setLoad((state) => ({
      status: "loading",
      models: state.models,
      at: state.at,
    }));
    try {
      const models = await provider.listModels(apiKey);
      setModelCache(provider.id, models);
      setLoad({ status: "ready", models, at: Date.now() });
    } catch (error) {
      setLoad((state) => ({
        status: "error",
        models: state.models,
        at: state.at,
        error: (error as Error).message,
      }));
    }
  }, [provider, apiKey]);

  // Fetch once on mount when there is no cache. The ref keeps StrictMode's
  // double effect (and a re-render) from fetching twice.
  const fetched = useRef(false);
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    if (load.status === "loading") void refresh();
  }, [load.status, refresh]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return load.models;
    return load.models.filter(
      (model) =>
        model.id.toLowerCase().includes(needle) ||
        model.name.toLowerCase().includes(needle),
    );
  }, [load.models, query]);

  const pickSlug = () => {
    const id = slug.trim();
    if (!id) return;
    const known = load.models.find((model) => model.id === id);
    void pick(known ?? customModel(provider.id, id));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search models"
            placeholder="Search models"
            className="pl-8"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Refresh model list"
          title={load.at ? `Updated ${timeAgo(load.at)}` : "Refresh"}
          disabled={load.status === "loading"}
          onClick={() => void refresh()}
        >
          <RefreshCw
            className={load.status === "loading" ? "animate-spin" : ""}
          />
        </Button>
      </div>

      {load.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load models: {load.error}
        </p>
      )}
      {inspectError && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't read that model's details: {inspectError}
        </p>
      )}
      {inspecting && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Checking what {inspecting} accepts…
        </p>
      )}
      {load.status === "loading" && load.models.length === 0 && (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          Loading models…
        </p>
      )}

      {load.models.length > 0 && (
        <ul
          aria-label="Models"
          className="flex max-h-80 flex-col gap-1 overflow-y-auto rounded-lg border p-1"
        >
          {visible.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">
              Nothing matches "{query}".
            </li>
          )}
          {visible.map((model) => (
            <li key={model.id}>
              <button
                type="button"
                aria-pressed={model.id === selected}
                aria-busy={inspecting === model.id || undefined}
                disabled={!!inspecting}
                onClick={() => void pick(model)}
                className="flex w-full cursor-pointer flex-col gap-1 rounded-md px-3 py-2 text-left hover:bg-muted aria-pressed:bg-primary/15"
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{model.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {model.id}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {badges(model).map((badge) => (
                    <Badge key={badge} variant="secondary">
                      {badge}
                    </Badge>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          pickSlug();
        }}
      >
        <Input
          aria-label="Model slug"
          placeholder="Or type a model slug not listed"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={!slug.trim()}>
          Use
        </Button>
      </form>
    </div>
  );
}

function timeAgo(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
