import { Check, Copy, Download, Wand2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/lib/cost";
import { videoFileName, type Run } from "@/lib/history";
import { runDuration } from "@/lib/time";

interface Props {
  run: Run;
  videoUrl: string;
  onRemix: (run: Run) => void;
}

/** The finished clip with download, copy-prompt and remix. */
export function ResultView({ run, videoUrl, onRemix }: Props) {
  const [copied, setCopied] = useState(false);
  const took = runDuration(run);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(run.request.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: nothing else to do.
    }
  };

  return (
    <section aria-label="Result" className="flex flex-col gap-3">
      <video
        src={videoUrl}
        autoPlay
        muted
        loop
        controls
        playsInline
        className="w-full rounded-xl border bg-black"
        data-testid="result-video"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild>
          <a href={videoUrl} download={videoFileName(run)}>
            <Download data-icon="inline-start" /> Download
          </a>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void copyPrompt()}
        >
          {copied ? (
            <Check data-icon="inline-start" />
          ) : (
            <Copy data-icon="inline-start" />
          )}
          {copied ? "Copied" : "Copy prompt"}
        </Button>
        <Button type="button" variant="outline" onClick={() => onRemix(run)}>
          <Wand2 data-icon="inline-start" /> Remix
        </Button>
        <p className="ml-auto text-sm text-muted-foreground" data-testid="cost">
          {run.costUsd !== undefined
            ? `Cost ${formatUsd(run.costUsd)}`
            : "Cost not reported"}
          {took ? ` · took ${took}` : ""}
          {run.videoBytes
            ? ` · ${(run.videoBytes / 1_000_000).toFixed(1)} MB`
            : ""}
        </p>
      </div>
    </section>
  );
}
