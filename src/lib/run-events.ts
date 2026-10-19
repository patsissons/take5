import { formatElapsed } from "@/lib/time";
import type { JobEvent } from "@/providers/types";

/** One line of the raw event table, ready to render. */
export interface EventRow {
  /** Time since the run started, e.g. "+12s". */
  offset: string;
  /** The wall-clock time, for a tooltip. */
  time: string;
  label: string;
  tone: "neutral" | "done" | "failed";
  detail: string;
  /** The provider payload on one line, and pretty-printed. */
  payload?: { line: string; pretty: string };
}

export function eventRow(event: JobEvent, startedAt: number): EventRow {
  const base = {
    offset: `+${formatElapsed(event.at - startedAt)}`,
    time: new Date(event.at).toLocaleTimeString(),
    payload: payload(event.raw),
  };
  switch (event.kind) {
    case "status":
      return {
        ...base,
        label: event.status,
        tone:
          event.status === "completed"
            ? "done"
            : event.status === "failed"
              ? "failed"
              : "neutral",
        detail: [
          event.queuePosition !== undefined ? `#${event.queuePosition}` : "",
          event.detail ?? "",
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "log":
      return { ...base, label: "log", tone: "neutral", detail: event.message };
    case "completed":
      return { ...base, label: "completed", tone: "done", detail: "" };
    case "failed":
      return { ...base, label: "failed", tone: "failed", detail: event.error };
  }
}

function payload(value: unknown): EventRow["payload"] {
  if (value === undefined) return undefined;
  try {
    const line = JSON.stringify(value);
    if (line === undefined) return undefined;
    return { line, pretty: JSON.stringify(value, null, 2) };
  } catch {
    return undefined;
  }
}
