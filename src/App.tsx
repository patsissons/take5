import { Clapperboard } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "@/components/composer";
import { DeleteEverything } from "@/components/delete-everything";
import { GitHubIcon } from "@/components/github-icon";
import { HistoryGallery } from "@/components/history-gallery";
import { PrivacyBanner } from "@/components/privacy-banner";
import { PrivacyPage } from "@/components/privacy-page";
import { ResultView } from "@/components/result-view";
import { RunView } from "@/components/run-view";
import { SetupCard, type SetupStep } from "@/components/setup-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { deleteDatabase, type Run } from "@/lib/history";
import { REPO_URL } from "@/lib/links";
import { useHash } from "@/lib/use-hash";
import { useHistory } from "@/lib/use-history";
import { isFinished, useRun } from "@/lib/use-run";
import { resolveModel, useSettings } from "@/lib/use-settings";
import { providerById, providers } from "@/providers";
import type { VideoModel, VideoRequest } from "@/providers/types";

export default function App() {
  const view = useHash();
  const settings = useSettings();
  const provider = settings.provider
    ? providerById(settings.provider)
    : undefined;
  const ready = !!(provider && settings.key && settings.model);
  const [setup, setSetup] = useState<SetupStep | null>(() =>
    ready ? null : "provider",
  );
  const [remix, setRemix] = useState<Partial<VideoRequest> | undefined>();
  const model = useMemo<VideoModel | undefined>(
    () =>
      provider && settings.model
        ? resolveModel(provider.id, settings.model)
        : undefined,
    [provider, settings.model],
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
      if (from.provider !== provider?.id) {
        settings.chooseProvider(from.provider);
      }
      if (from.request.model !== settings.model) {
        settings.chooseModel(from.provider, from.request.model);
      }
      setRemix(from.request);
      run.clear();
      window.scrollTo({ top: 0 });
    },
    [provider?.id, settings, run],
  );

  const deleteEverything = useCallback(async () => {
    run.clear();
    await deleteDatabase();
    settings.reset();
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
              Five-second AI videos, straight from your browser.
            </p>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex flex-1 flex-col gap-6">
          {view === "privacy" ? (
            <PrivacyPage onDeleteEverything={() => void deleteEverything()} />
          ) : setup || !provider || !model || !settings.key ? (
            <SetupCard
              providers={providers}
              settings={settings}
              step={setup ?? "provider"}
              onStep={setSetup}
              onDone={() => setSetup(null)}
            />
          ) : (
            <>
              <div
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
                data-testid="studio-bar"
              >
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
                  onClick={() => setSetup("model")}
                >
                  Change model
                </Button>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  onClick={() => setSetup("provider")}
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
              </div>

              <Composer
                key={`${model.id}:${remix ? "remix" : "fresh"}`}
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
              {run.current?.status === "completed" && run.current.videoUrl && (
                <ResultView
                  run={run.current.run}
                  videoUrl={run.current.videoUrl}
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
                setSetup(null);
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
