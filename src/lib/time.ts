import type { Run } from "@/lib/history";

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/** How long a finished run took, from submit to the provider's answer. */
export function runDuration(
  run: Pick<Run, "createdAt" | "finishedAt">,
): string | undefined {
  return run.finishedAt === undefined
    ? undefined
    : formatElapsed(run.finishedAt - run.createdAt);
}
