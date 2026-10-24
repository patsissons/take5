import { Clapperboard, ImageIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { runKind, type Run } from "@/lib/history";
import { formatBytes } from "@/lib/use-history";

interface Props {
  runs: readonly Run[];
  /** Runs left out; empty means every run goes, including newer ones. */
  excluded: ReadonlySet<string>;
  onChange: (excluded: Set<string>) => void;
}

/** Which runs the history file carries: all by default, one tick each. */
export function HistoryPicker({ runs, excluded, onChange }: Props) {
  const chosen = runs.filter((run) => !excluded.has(run.id)).length;
  const all =
    chosen === runs.length ? true : chosen === 0 ? false : "indeterminate";

  const toggle = (id: string, on: boolean) => {
    const next = new Set(excluded);
    if (on) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Checkbox
          id="handoff-all"
          checked={all}
          onCheckedChange={() =>
            onChange(
              all === true ? new Set(runs.map((run) => run.id)) : new Set(),
            )
          }
        />
        <Label htmlFor="handoff-all">Select all</Label>
        <span className="ml-auto text-xs text-muted-foreground">
          {chosen} of {runs.length} selected
        </span>
      </div>
      <ul
        aria-label="Runs to bring"
        className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border p-1"
      >
        {runs.map((run) => {
          const id = `handoff-run-${run.id}`;
          const Icon = runKind(run) === "image" ? ImageIcon : Clapperboard;
          return (
            <li key={run.id} className="flex items-center gap-2 rounded-md p-1">
              <Checkbox
                id={id}
                checked={!excluded.has(run.id)}
                onCheckedChange={(on) => toggle(run.id, on === true)}
              />
              <Label
                htmlFor={id}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 font-normal"
              >
                {run.thumbnail ? (
                  <img
                    src={run.thumbnail}
                    alt=""
                    className="size-9 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="flex size-9 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                    <Icon aria-hidden className="size-4" />
                  </span>
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{run.request.prompt}</span>
                  <span className="text-xs text-muted-foreground">
                    {run.status === "failed"
                      ? "Failed"
                      : run.videoBytes
                        ? formatBytes(run.videoBytes)
                        : runKind(run) === "image"
                          ? "Image"
                          : "Video"}
                  </span>
                </span>
              </Label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
