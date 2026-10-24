import { X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { CodeInput } from "@/components/code-input";
import { Included } from "@/components/handoff-dialog";
import { HistoryImport } from "@/components/history-import";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  CODE_LENGTH,
  isCompleteCode,
  openHandoff,
  type HandoffConfig,
} from "@/lib/handoff";

interface Props {
  /** The `#handoff=` payload the link carried. */
  sealed: string;
  /** This device already has a provider set up. */
  replacing: boolean;
  onApply: (config: HandoffConfig) => void;
  onHistoryImported: () => void;
  /** Finished, or backed out: back to the studio or setup. */
  onDone: () => void;
}

const ERRORS = {
  code: "That code doesn't match. Check it on your other device.",
  expired:
    "This link has expired. Open “Use on phone” on your other device for a new one.",
  malformed:
    "This link is damaged. Scan the QR code again, or copy the link afresh.",
};

type Step =
  { id: "code" } | { id: "preview"; config: HandoffConfig } | { id: "history" };

/** The phone's side of a handoff: unlock with the code, then import. */
export function HandoffReceive({
  sealed,
  replacing,
  onApply,
  onHistoryImported,
  onDone,
}: Props) {
  const [step, setStep] = useState<Step>({ id: "code" });
  const [chars, setChars] = useState<string[]>(() =>
    Array<string>(CODE_LENGTH).fill(""),
  );
  const code = chars.join("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!isCompleteCode(code)) return;
    setBusy(true);
    setError(null);
    const opened = await openHandoff(sealed, code);
    setBusy(false);
    if (opened.ok) setStep({ id: "preview", config: opened.config });
    else setError(ERRORS[opened.reason]);
  };

  return (
    <section
      aria-labelledby="handoff-title"
      className="rounded-xl border bg-card p-5 sm:p-6"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 id="handoff-title" className="text-lg font-semibold">
          {step.id === "history"
            ? "Bring your history"
            : "Settings from your other device"}
        </h2>
        {step.id !== "history" && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            <X data-icon="inline-start" /> Cancel
          </Button>
        )}
      </div>

      {step.id === "code" && (
        <form onSubmit={(event) => void unlock(event)}>
          <p className="text-sm text-muted-foreground">
            Type the code shown next to the QR code to unlock them.
          </p>
          <div className="mt-4 grid gap-2">
            <Label id="handoff-code-label">Code</Label>
            <CodeInput
              labelledBy="handoff-code-label"
              value={chars}
              onChange={(next) => {
                setChars(next);
                setError(null);
              }}
              invalid={!!error}
              disabled={busy}
            />
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-4">
            <Button type="submit" disabled={busy || !isCompleteCode(code)}>
              {busy ? "Unlocking…" : "Unlock"}
            </Button>
          </div>
        </form>
      )}

      {step.id === "preview" && (
        <div className="flex flex-col gap-4">
          <Included config={step.config} />
          {replacing && (
            <p className="text-sm text-muted-foreground">
              This replaces the provider, model and matching keys on this
              device. Other keys stay.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => {
                onApply(step.config);
                if (step.config.history) setStep({ id: "history" });
                else onDone();
              }}
            >
              Import
            </Button>
          </div>
        </div>
      )}

      {step.id === "history" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Settings imported. Your other device is sending a history file: once
            it's on this phone (AirDrop, Nearby Share, Files), pick it here.
          </p>
          <HistoryImport variant="default" onImported={onHistoryImported} />
          <div>
            <Button type="button" variant="ghost" onClick={onDone}>
              Continue
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
