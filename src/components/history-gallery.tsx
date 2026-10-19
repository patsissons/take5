import { Film, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/lib/cost";
import type { Run } from "@/lib/history";
import { runDuration } from "@/lib/time";
import { formatBytes } from "@/lib/use-history";
import { providerById } from "@/providers";

interface Props {
  runs: Run[];
  estimate: { usage: number; quota: number } | null;
  /** The run shown in the studio, if any. */
  currentId?: string;
  onOpen: (run: Run) => void;
  onRemix: (run: Run) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

/** Past runs, newest first, with the space they take on this device. */
export function HistoryGallery({
  runs,
  estimate,
  currentId,
  onOpen,
  onRemix,
  onDelete,
  onClear,
}: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  if (runs.length === 0) return null;

  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="history-title" className="text-lg font-semibold">
          History
        </h2>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {estimate && (
            <span data-testid="storage-meter">
              {formatBytes(estimate.usage)} used on this device
            </span>
          )}
          {confirmClear ? (
            <>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  setConfirmClear(false);
                  onClear();
                }}
              >
                Really clear {runs.length} runs
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmClear(false)}
              >
                Keep
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmClear(true)}
            >
              Clear all
            </Button>
          )}
        </div>
      </div>
      <ul
        aria-label="Past runs"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {runs.map((run) => (
          <li
            key={run.id}
            aria-current={run.id === currentId ? "true" : undefined}
            className="flex gap-3 rounded-xl border bg-card p-3 aria-[current]:border-primary"
          >
            <button
              type="button"
              aria-label={`Open run: ${run.request.prompt}`}
              onClick={() => onOpen(run)}
              className="flex size-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-muted"
            >
              {run.thumbnail ? (
                <img
                  src={run.thumbnail}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <Film aria-hidden className="size-6 text-muted-foreground" />
              )}
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="line-clamp-2 text-sm" title={run.request.prompt}>
                {run.request.prompt || <em>No prompt</em>}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {providerById(run.provider)?.label ?? run.provider} ·{" "}
                {run.modelName}
                {run.request.duration ? ` · ${run.request.duration}s` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                <span
                  className={
                    run.status === "failed"
                      ? "text-destructive"
                      : run.status === "running"
                        ? "text-primary"
                        : ""
                  }
                >
                  {run.status === "completed"
                    ? "Done"
                    : run.status === "running"
                      ? "In flight"
                      : "Failed"}
                </span>
                {" · "}
                {new Date(run.createdAt).toLocaleString()}
                {run.costUsd !== undefined
                  ? ` · ${formatUsd(run.costUsd)}`
                  : ""}
                {run.finishedAt ? ` · ${runDuration(run)}` : ""}
                {run.videoBytes ? ` · ${formatBytes(run.videoBytes)}` : ""}
              </p>
              <div className="mt-auto flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => onRemix(run)}
                >
                  <Wand2 data-icon="inline-start" /> Remix
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={`Delete run: ${run.request.prompt}`}
                  onClick={() => onDelete(run.id)}
                >
                  <Trash2 data-icon="inline-start" /> Delete
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
