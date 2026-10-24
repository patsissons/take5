import { Clapperboard } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "@/components/composer";
import { DeleteEverything } from "@/components/delete-everything";
import { GitHubIcon } from "@/components/github-icon";
import { HandoffDialog } from "@/components/handoff-dialog";
import { HandoffReceive } from "@/components/handoff-receive";
import { HistoryGallery } from "@/components/history-gallery";
import { ModeToggle } from "@/components/mode-toggle";
import { PrivacyBanner } from "@/components/privacy-banner";
import { PrivacyPage } from "@/components/privacy-page";
import { ResultView } from "@/components/result-view";
import { RunView } from "@/components/run-view";
import { SetupCard, type SetupStep } from "@/components/setup-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { applyHandoff, type HandoffConfig } from "@/lib/handoff";
import { deleteDatabase, runKind, type Run } from "@/lib/history";
import { REPO_URL } from "@/lib/links";
import { getKey, getLastModel, getModelCache } from "@/lib/settings";
import { useHandoffLink } from "@/lib/use-handoff-link";
import { useHash } from "@/lib/use-hash";
import { useHistory } from "@/lib/use-history";
import { isFinished, useRun } from "@/lib/use-run";
import { resolveModel, useSettings } from "@/lib/use-settings";
import { providerById, providers } from "@/providers";
import type { ProviderId } from "@/providers/hosts";
import type { MediaKind, MediaModel, MediaRequest } from "@/providers/types";

export default function App() {
  const view = useHash();
  const [incoming, clearIncoming] = useHandoffLink();
  const settings = useSettings();
  const provider = settings.provider
    ? providerById(settings.provider)
    : undefined;
  const ready = !!(provider && settings.key && settings.model);
  const [setup, setSetup] = useState<SetupStep | null>(() =>
    ready ? null : "provider",
  );
  // The provider and mode to go back to when a visitor backs out of
  // "Change model", "Change provider" or a switch to a mode with no model
  // yet, from the studio.
  const [returnTo, setReturnTo] = useState<{
    provider: ProviderId;
    mode: MediaKind;
  } | null>(null);
  const [remix, setRemix] = useState<Partial<MediaRequest> | undefined>();
  // Resolved again when setup closes: a handed-off model only gets its
  // cached record once the picker has fetched the list.
  const model = useMemo<MediaModel | undefined>(
    () =>
      provider && settings.model && !setup
        ? resolveModel(provider.id, settings.model, settings.mode)
        : undefined,
    [provider, settings.model, settings.mode, setup],
  );
  const run = useRun(provider, settings.key);
  const history = useHistory();
  const busy = !!run.current && !isFinished(run.current.status);

  // A finished run (either way) changes the gallery.
  const status = run.current?.status;
  useEffect(() => {
    if (status && isFinished(status)) void history.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Pick up a job that was in flight when the page was last closed.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !history.loaded || !provider || !settings.key)
      return;
    resumed.current = true;
    const inFlight = history.runs.find(
      (r) => r.status === "running" && r.job && r.provider === provider.id,
    );
    if (inFlight) void run.resume(inFlight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.loaded, provider?.id, settings.key]);

  const onRemix = useCallback(
    (from: Run) => {
      const kind = runKind(from);
      if (kind !== settings.mode) settings.chooseMode(kind);
      if (from.provider !== provider?.id) {
        settings.chooseProvider(from.provider);
      }
      if (from.request.model !== settings.model || kind !== settings.mode) {
        settings.chooseModel(from.provider, from.request.model, kind);
      }
      setRemix(from.request);
      run.clear();
      window.scrollTo({ top: 0 });
    },
    [provider?.id, settings, run],
  );

  const change = (step: SetupStep) => {
    if (provider) setReturnTo({ provider: provider.id, mode: settings.mode });
    setSetup(step);
  };

  /** Switches mode; without a model for it yet, picking one comes first. */
  const switchMode = (mode: MediaKind) => {
    if (!provider) return;
    const known = getLastModel(provider.id, mode);
    if (!known) change("model");
    settings.chooseMode(mode);
  };

  const cancelSetup = useCallback(() => {
    if (returnTo && returnTo.mode !== settings.mode) {
      settings.chooseMode(returnTo.mode);
    }
    if (returnTo && returnTo.provider !== settings.provider) {
      settings.chooseProvider(returnTo.provider);
    }
    setReturnTo(null);
    setSetup(null);
  }, [returnTo, settings]);

  /**
   * A handoff's settings land; without a cached model list (it stays on the
   * other device) the picker fetches it with the model already chosen.
   */
  const acceptHandoff = useCallback(
    (config: HandoffConfig) => {
      run.clear();
      applyHandoff(config);
      settings.reload();
      setReturnTo(null);
      const { provider: id, mode } = config;
      setSetup(
        !getKey(id)
          ? "key"
          : !getLastModel(id, mode) || !getModelCache(id, mode)
            ? "model"
            : null,
      );
    },
    [run, settings],
  );

  const deleteEverything = useCallback(async () => {
    run.clear();
    await deleteDatabase();
    settings.reset();
    setReturnTo(null);
    setSetup("provider");
    history.forget();
    window.location.hash = "";
  }, [run, settings, history]);

  return (
    <div className="flex min-h-dvh flex-col">
      <PrivacyBanner />
      <div className="safe-x mx-auto flex w-full max-w-3xl flex-1 flex-col py-8 sm:py-12">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-4xl font-bold tracking-tight sm:text-5xl">
              <a href="#" className="contents">
                <Clapperboard
                  aria-hidden
                  className="size-9 text-primary sm:size-11"
                  strokeWidth={2.5}
                />
                take5
              </a>
            </h1>
            <p className="mt-3 max-w-xl text-lg text-muted-foreground">
              Five-second AI videos and stills, straight from your browser.
            </p>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex flex-1 flex-col gap-6">
          {view === "privacy" ? (
            <PrivacyPage onDeleteEverything={() => void deleteEverything()} />
          ) : incoming ? (
            <HandoffReceive
              sealed={incoming}
              replacing={!!provider}
              onApply={acceptHandoff}
              onHistoryImported={() => void history.reload()}
              onDone={clearIncoming}
            />
          ) : setup || !provider || !model || !settings.key ? (
            <SetupCard
              providers={providers}
              settings={settings}
              step={setup ?? "provider"}
              onStep={setSetup}
              onDone={() => {
                setReturnTo(null);
                setSetup(null);
              }}
              onCancel={returnTo ? cancelSetup : undefined}
            />
          ) : (
            <>
              <div
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
                data-testid="studio-bar"
              >
                <ModeToggle
                  mode={settings.mode}
                  kinds={provider.kinds}
                  disabled={busy}
                  onChange={switchMode}
                />
                <span>
                  <span className="font-medium text-foreground">
                    {provider.label}
                  </span>
                  {" · "}
                  <span className="font-medium text-foreground">
                    {model.name}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  onClick={() => change("model")}
                >
                  Change model
                </Button>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  onClick={() => change("provider")}
                >
                  Change provider
                </Button>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  onClick={() => {
                    settings.forgetKey(provider.id);
                    setSetup("key");
                  }}
                >
                  Forget key
                </Button>
                <HandoffDialog
                  runs={history.runs}
                  disabled={busy}
                  onHistoryImported={() => void history.reload()}
                />
              </div>

              <Composer
                key={`${model.kind}:${model.id}:${remix ? "remix" : "fresh"}`}
                model={model}
                initial={remix}
                busy={busy}
                onGenerate={(req) => {
                  setRemix(undefined);
                  void run.start(req, model);
                }}
              />

              {run.current && (
                <RunView
                  state={run.current}
                  canCancel={provider.canCancel}
                  onCancel={() => void run.cancel()}
                />
              )}
              {run.current?.status === "completed" && run.current.mediaUrl && (
                <ResultView
                  run={run.current.run}
                  mediaUrl={run.current.mediaUrl}
                  onRemix={onRemix}
                />
              )}
            </>
          )}

          {view === "studio" && (
            <HistoryGallery
              runs={history.runs}
              estimate={history.estimate}
              currentId={run.current?.run.id}
              onOpen={(r) => {
                cancelSetup();
                void run.show(r);
                window.scrollTo({ top: 0 });
              }}
              onRemix={onRemix}
              onDelete={(id) => {
                if (run.current?.run.id === id) run.clear();
                void history.remove(id);
              }}
              onClear={() => {
                run.clear();
                void history.clear();
              }}
            />
          )}
        </main>

        <footer className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <a
            href={REPO_URL}
            className="inline-flex items-center gap-1.5 hover:text-foreground"
          >
            <GitHubIcon className="size-4" />
            Source on GitHub
          </a>
          <a href="#privacy" className="hover:text-foreground">
            Privacy
          </a>
          <span className="ml-auto">
            <DeleteEverything onConfirm={() => void deleteEverything()} />
          </span>
        </footer>
      </div>
    </div>
  );
}
