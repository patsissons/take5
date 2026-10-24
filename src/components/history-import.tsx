import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BackupError, importBackup } from "@/lib/backup";

interface Props {
  onImported: (added: number) => void;
  variant?: "default" | "outline";
}

type Status =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "done"; added: number; skipped: number }
  | { state: "error"; message: string };

/** Picks a take5 history file and adds its runs to this device. */
export function HistoryImport({ onImported, variant = "outline" }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setStatus({ state: "busy" });
    try {
      const { added, skipped } = await importBackup(file);
      setStatus({ state: "done", added, skipped });
      onImported(added);
    } catch (caught) {
      setStatus({
        state: "error",
        message:
          caught instanceof BackupError
            ? caught.message
            : "That history file couldn't be read.",
      });
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* No `accept`: iOS greys out extensions it doesn't know. */}
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="History file"
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      <Button
        type="button"
        variant={variant}
        disabled={status.state === "busy"}
        onClick={() => input.current?.click()}
      >
        <Upload data-icon="inline-start" />
        {status.state === "busy" ? "Importing…" : "Import history file"}
      </Button>
      {status.state === "done" && (
        <p role="status" className="text-sm text-muted-foreground">
          {status.added === 1 ? "Added 1 run" : `Added ${status.added} runs`}
          {status.skipped ? ` (${status.skipped} already here)` : ""}.
        </p>
      )}
      {status.state === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {status.message}
        </p>
      )}
    </div>
  );
}
