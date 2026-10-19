import { Check, CircleDashed, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { eventRow } from "@/lib/run-events";
import type { RunState } from "@/lib/use-run";
import { isFinished } from "@/lib/use-run";
import { formatElapsed } from "@/lib/time";
import type { JobStatus } from "@/providers/types";

interface Props {
  state: RunState;
  canCancel: boolean;
  onCancel: () => void;
}

const STEPS: Array<{ id: JobStatus; label: string }> = [
  { id: "submitted", label: "Submitted" },
  { id: "queued", label: "Queued" },
  { id: "running", label: "Generating" },
  { id: "completed", label: "Done" },
];

const ORDER: JobStatus[] = ["submitted", "queued", "running", "completed"];

/** The live timeline of one job, with an elapsed clock and the raw feed. */
export function RunView({ state, canCancel, onCancel }: Props) {
  const finished = isFinished(state.status);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [finished]);
  const end = finished ? (state.run.finishedAt ?? now) : now;
  const elapsed = formatElapsed(end - state.run.createdAt);
  // How far the job got: the last timeline status seen, so a failure is
  // marked on the step it died in.
  const progress = isFinished(state.status)
    ? state.status === "completed"
      ? "completed"
      : lastProgress(state)
    : state.status;
  const position = ORDER.indexOf(progress);

  return (
    <section
      aria-label="Progress"
      aria-live="polite"
      className="rounded-xl border bg-card p-4 sm:p-5"
    >
      <ol className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {STEPS.map((step, i) => {
          const done = position > i || state.status === "completed";
          const active = position === i && !finished;
          const failed =
            finished && state.status !== "completed" && position === i;
          return (
            <li
              key={step.id}
              aria-current={active ? "step" : undefined}
              className={`flex items-center gap-1.5 ${
                done || active ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {done ? (
                <Check aria-hidden className="size-4 text-primary" />
              ) : active ? (
                <Loader2
                  aria-hidden
                  className="size-4 animate-spin text-primary"
                />
              ) : failed ? (
                <X aria-hidden className="size-4 text-destructive" />
              ) : (
                <CircleDashed aria-hidden className="size-4" />
              )}
              {step.label}
              {step.id === "queued" &&
                state.queuePosition !== undefined &&
                !done && (
                  <span className="text-muted-foreground">
                    #{state.queuePosition}
                  </span>
                )}
            </li>
          );
        })}
        <li
          className="ml-auto tabular-nums text-muted-foreground"
          data-testid="elapsed"
        >
          {elapsed}
        </li>
      </ol>

      {state.status === "failed" && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {state.error ?? "The job failed."}
        </p>
      )}
      {state.status === "cancelled" && (
        <p className="mt-3 text-sm text-muted-foreground">
          {canCancel ? "Cancelled." : "Stopped watching this job."}
        </p>
      )}

      <div className="mt-3 flex items-start justify-between gap-3">
        <details className="min-w-0 flex-1 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Raw events ({state.events.length})
          </summary>
          <div className="mt-2 max-h-72 overflow-auto rounded-md border">
            <table className="w-full min-w-[32rem] text-left">
              <thead className="sticky top-0 bg-muted text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Time</th>
                  <th className="px-2 py-1.5 font-medium">Event</th>
                  <th className="px-2 py-1.5 font-medium">Detail</th>
                  <th className="px-2 py-1.5 font-medium">Payload</th>
                </tr>
              </thead>
              <tbody>
                {state.events.map((event, i) => {
                  const row = eventRow(event, state.run.createdAt);
                  return (
                    <tr key={i} className="border-t align-top">
                      <td
                        className="px-2 py-1.5 whitespace-nowrap tabular-nums text-muted-foreground"
                        title={row.time}
                      >
                        {row.offset}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge
                          variant={
                            row.tone === "failed"
                              ? "destructive"
                              : row.tone === "done"
                                ? "default"
                                : "secondary"
                          }
                        >
                          {row.label}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 break-words">{row.detail}</td>
                      <td className="px-2 py-1.5">
                        {row.payload && (
                          <details className="max-w-80">
                            <summary className="cursor-pointer truncate font-mono text-muted-foreground">
                              {row.payload.line}
                            </summary>
                            <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono">
                              {row.payload.pretty}
                            </pre>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
        {!finished && (
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            {canCancel ? "Cancel" : "Stop watching"}
          </Button>
        )}
      </div>
    </section>
  );
}

function lastProgress(state: RunState): JobStatus {
  for (let i = state.events.length - 1; i >= 0; i--) {
    const event = state.events[i]!;
    if (event.kind === "status" && ORDER.includes(event.status)) {
      return event.status;
    }
  }
  return "submitted";
}
