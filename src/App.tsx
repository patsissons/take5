import { Clapperboard } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Composer } from "@/components/composer";
import { GitHubIcon } from "@/components/github-icon";
import { PrivacyBanner } from "@/components/privacy-banner";
import { ResultView } from "@/components/result-view";
import { RunView } from "@/components/run-view";
import { SetupCard, type SetupStep } from "@/components/setup-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import type { Run } from "@/lib/history";
import { isFinished, useRun } from "@/lib/use-run";
import { resolveModel, useSettings } from "@/lib/use-settings";
import { providerById, providers } from "@/providers";
import type { VideoModel, VideoRequest } from "@/providers/types";
import { REPO_URL } from "@/lib/links";

export default function App() {
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
  const busy = !!run.current && !isFinished(run.current.status);

  const onRemix = useCallback(
    (from: Run) => {
      setRemix(from.request);
      run.clear();
    },
    [run],
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <PrivacyBanner />
      <div className="safe-x mx-auto flex w-full max-w-3xl flex-1 flex-col py-8 sm:py-12">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-4xl font-bold tracking-tight sm:text-5xl">
              <Clapperboard
                aria-hidden
                className="size-9 text-primary sm:size-11"
                strokeWidth={2.5}
              />
              take5
            </h1>
            <p className="mt-3 max-w-xl text-lg text-muted-foreground">
              Five-second AI videos, straight from your browser.
            </p>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex flex-1 flex-col gap-4">
          {setup || !provider || !model || !settings.key ? (
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
        </main>

        <footer className="mt-12 flex items-center gap-4 text-sm text-muted-foreground">
          <a
            href={REPO_URL}
            className="inline-flex items-center gap-1.5 hover:text-foreground"
          >
            <GitHubIcon className="size-4" />
            Source on GitHub
          </a>
        </footer>
      </div>
    </div>
  );
}
