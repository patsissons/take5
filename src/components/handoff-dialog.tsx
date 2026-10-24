import { Check, Copy, Download, RefreshCw, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { HistoryImport } from "@/components/history-import";
import { QrCode } from "@/components/qr-code";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { backupFileName, exportBackup } from "@/lib/backup";
import {
  collectHandoff,
  formatCode,
  handoffLink,
  maskKey,
  newCode,
  sealHandoff,
  type HandoffConfig,
} from "@/lib/handoff";
import type { Run } from "@/lib/history";
import { formatBytes } from "@/lib/use-history";
import { providerById } from "@/providers";
import type { ProviderId } from "@/providers/hosts";

interface Props {
  /** The gallery, for the history file's size. */
  runs: readonly Run[];
  disabled?: boolean;
  onHistoryImported: () => void;
}

interface Sealed {
  code: string;
  link: string;
  config: HandoffConfig;
}

/**
 * "Use on phone": this device's setup as a QR code plus a code to type,
 * and optionally a history file to send across by hand.
 */
export function HandoffDialog({ runs, disabled, onHistoryImported }: Props) {
  const [open, setOpen] = useState(false);
  const [withHistory, setWithHistory] = useState(false);
  // Bumped by "New code" to seal again.
  const [round, setRound] = useState(0);
  const [sealed, setSealed] = useState<Sealed | null>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const config = collectHandoff(withHistory);
    if (!config) return;
    const code = newCode();
    void sealHandoff(config, code).then((payload) => {
      if (live) {
        setSealed({
          code,
          config,
          link: handoffLink(payload, window.location),
        });
      }
    });
    return () => {
      live = false;
    };
  }, [open, withHistory, round]);

  const finished = runs.filter((run) => run.status !== "running");
  const bytes = finished.reduce(
    (total, run) => total + (run.videoBytes ?? 0),
    0,
  );

  const copyLink = async () => {
    if (!sealed) return;
    try {
      await navigator.clipboard.writeText(sealed.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the QR still works.
    }
  };

  const download = async () => {
    setExporting(true);
    try {
      const backup = await exportBackup();
      const url = URL.createObjectURL(backup.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = backupFileName();
      anchor.click();
      // Safari reads the blob after the click returns.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSealed(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="link" size="xs" disabled={disabled}>
          <Smartphone data-icon="inline-start" /> Use on phone
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Use on your phone</DialogTitle>
          <DialogDescription>
            Scan this with your phone's camera, then type the code there. The
            link carries your settings and keys encrypted; nothing goes through
            a server.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          {sealed ? (
            <div data-testid="handoff-qr" data-link={sealed.link}>
              <QrCode
                value={sealed.link}
                label="QR code for your phone"
                className="size-56 rounded-lg"
              />
            </div>
          ) : (
            <div
              className="flex size-56 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground"
              role="status"
            >
              Encrypting…
            </div>
          )}
          <p
            className="font-mono text-3xl font-semibold tracking-widest"
            data-testid="handoff-code"
            aria-label="Code to type on your phone"
          >
            {sealed ? formatCode(sealed.code) : "····-····"}
          </p>
          <p className="text-center text-xs text-muted-foreground">
            Type this code on your phone. The link works for 10 minutes.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!sealed}
              onClick={() => void copyLink()}
            >
              {copied ? (
                <Check data-icon="inline-start" />
              ) : (
                <Copy data-icon="inline-start" />
              )}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!sealed}
              onClick={() => {
                setSealed(null);
                setRound((n) => n + 1);
              }}
            >
              <RefreshCw data-icon="inline-start" /> New code
            </Button>
          </div>
        </div>

        {sealed && <Included config={sealed.config} />}

        <div className="flex flex-col gap-3 border-t pt-4">
          <div className="flex items-center gap-2">
            <Switch
              id="handoff-history"
              checked={withHistory}
              onCheckedChange={(next) => {
                setSealed(null);
                setWithHistory(next);
              }}
            />
            <Label htmlFor="handoff-history">
              Also bring history and media
            </Label>
          </div>
          {withHistory && (
            <>
              <Button
                type="button"
                disabled={exporting || finished.length === 0}
                onClick={() => void download()}
              >
                <Download data-icon="inline-start" />
                {exporting
                  ? "Packing…"
                  : `Download history file (${finished.length === 1 ? "1 run" : `${finished.length} runs`} · ${formatBytes(bytes)})`}
              </Button>
              <p className="text-xs text-muted-foreground">
                Send the file to your phone yourself (AirDrop, Nearby Share,
                Files), then tap "Import history file" there. It holds no keys.
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Got a history file from another device?
          </p>
          <HistoryImport onImported={onHistoryImported} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The providers (keys masked) and choices a handoff carries. */
export function Included({ config }: { config: HandoffConfig }) {
  const keys = Object.entries(config.keys) as Array<[ProviderId, string]>;
  return (
    <div className="text-sm">
      <p className="font-medium">Included</p>
      <ul className="mt-1 text-muted-foreground" aria-label="Included">
        {keys.map(([id, key]) => (
          <li key={id}>
            {providerById(id)?.label ?? id}{" "}
            <span className="font-mono text-xs">{maskKey(key)}</span>
          </li>
        ))}
        <li>
          {config.models.length === 1
            ? "1 model choice"
            : `${config.models.length} model choices`}
          , {config.mode} mode
        </li>
      </ul>
    </div>
  );
}
