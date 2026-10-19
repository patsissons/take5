import { ExternalLink, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { ModelPicker } from "@/components/model-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { useSettings } from "@/lib/use-settings";
import type { KeyInfo, VideoModel, VideoProvider } from "@/providers/types";

export type SetupStep = "provider" | "key" | "model";

interface Props {
  providers: readonly VideoProvider[];
  settings: ReturnType<typeof useSettings>;
  step: SetupStep;
  onStep: (step: SetupStep) => void;
  onDone: (model: VideoModel) => void;
  /** Back to the studio unchanged; only offered once setup was complete. */
  onCancel?: () => void;
}

const STEPS: Array<{ id: SetupStep; title: string }> = [
  { id: "provider", title: "Provider" },
  { id: "key", title: "API key" },
  { id: "model", title: "Model" },
];

/** First run: choose a provider, paste a key, pick a model. */
export function SetupCard({
  providers,
  settings,
  step,
  onStep,
  onDone,
  onCancel,
}: Props) {
  const provider = providers.find((p) => p.id === settings.provider);
  const index = STEPS.findIndex((s) => s.id === step);

  useEffect(() => {
    if (!onCancel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <section
      aria-labelledby="setup-title"
      className="rounded-xl border bg-card p-5 sm:p-6"
    >
      <div className="mb-5 flex items-start justify-between gap-2">
        <ol className="flex flex-wrap gap-2 text-sm" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              aria-current={s.id === step ? "step" : undefined}
              className={`flex items-center gap-2 ${
                i <= index ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <span
                className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold ${
                  i < index
                    ? "bg-primary text-primary-foreground"
                    : i === index
                      ? "border-2 border-primary"
                      : "border"
                }`}
              >
                {i + 1}
              </span>
              {s.title}
            </li>
          ))}
        </ol>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="Back to the studio without changes (Esc)"
            onClick={onCancel}
          >
            <X data-icon="inline-start" /> Cancel
          </Button>
        )}
      </div>

      {step === "provider" && (
        <>
          <h2 id="setup-title" className="text-lg font-semibold">
            Pick a provider
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your browser talks to this provider directly, with your own key.
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Providers">
            {providers.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    settings.chooseProvider(p.id);
                    onStep("key");
                  }}
                  aria-pressed={p.id === settings.provider}
                  className="w-full cursor-pointer rounded-lg border px-4 py-3 text-left hover:border-primary/60 hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary/10"
                >
                  <span className="font-medium">{p.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {p.hosts.join(", ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {step === "key" && provider && (
        <KeyStep
          provider={provider}
          settings={settings}
          onBack={() => onStep("provider")}
          onDone={() => onStep("model")}
        />
      )}

      {step === "model" && provider && settings.key && (
        <>
          <h2 id="setup-title" className="text-lg font-semibold">
            Choose a model
          </h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            Only {provider.label}'s video models are listed.
          </p>
          <ModelPicker
            provider={provider}
            apiKey={settings.key}
            selected={settings.model}
            onPick={(model) => {
              settings.chooseModel(provider.id, model.id);
              onDone(model);
            }}
          />
          <div className="mt-4 flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onStep("key")}>
              Back
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function KeyStep({
  provider,
  settings,
  onBack,
  onDone,
}: {
  provider: VideoProvider;
  settings: Props["settings"];
  onBack: () => void;
  onDone: () => void;
}) {
  const [key, setKey] = useState(settings.key ?? "");
  const [remember, setRemember] = useState(settings.remember);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<KeyInfo | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await provider.validateKey(trimmed);
      setInfo(result);
      settings.saveKey(provider.id, trimmed, remember);
      onDone();
    } catch (caught) {
      setError((caught as Error).message || "That key was rejected");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <h2 id="setup-title" className="text-lg font-semibold">
        Paste your {provider.label} API key
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        It is checked with one cheap request, then kept only in this browser.{" "}
        <a
          href={provider.keyUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 underline hover:text-foreground"
        >
          Get a key <ExternalLink aria-hidden className="size-3" />
        </a>
      </p>
      <div className="mt-4 grid gap-2">
        <Label htmlFor="api-key">API key</Label>
        <Input
          id="api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={provider.keyHint}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Switch
          id="remember"
          checked={remember}
          onCheckedChange={setRemember}
        />
        <Label htmlFor="remember">Remember on this device</Label>
      </div>
      {!remember && (
        <p className="mt-1 text-xs text-muted-foreground">
          The key is forgotten when this tab closes.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {info?.label && (
        <p className="mt-3 text-sm text-muted-foreground">
          Key "{info.label}" works.
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={busy || !key.trim()}>
          {busy ? "Checking…" : "Check and continue"}
        </Button>
        {settings.key && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              settings.forgetKey(provider.id);
              setKey("");
              setInfo(null);
            }}
          >
            Forget key
          </Button>
        )}
      </div>
    </form>
  );
}
