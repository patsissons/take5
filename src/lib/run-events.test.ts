import { describe, expect, it } from "vitest";
import { eventRow } from "./run-events";

describe("eventRow", () => {
  it("splits a status event into offset, label, detail and payload", () => {
    const row = eventRow(
      {
        kind: "status",
        at: 13_000,
        status: "queued",
        queuePosition: 3,
        detail: "warming up",
        raw: { status: "IN_QUEUE", queue_position: 3 },
      },
      1_000,
    );
    expect(row).toMatchObject({
      offset: "+12s",
      label: "queued",
      tone: "neutral",
      detail: "#3 · warming up",
      payload: {
        line: '{"status":"IN_QUEUE","queue_position":3}',
        pretty: '{\n  "status": "IN_QUEUE",\n  "queue_position": 3\n}',
      },
    });
    expect(row.time).toBe(new Date(13_000).toLocaleTimeString());
  });

  it("shows logs, completions and failures in their own words", () => {
    expect(eventRow({ kind: "log", at: 0, message: "rendering" }, 0)).toEqual(
      expect.objectContaining({ label: "log", detail: "rendering" }),
    );
    expect(eventRow({ kind: "completed", at: 65_000, result: {} }, 0)).toEqual(
      expect.objectContaining({
        offset: "+1m 5s",
        label: "completed",
        tone: "done",
      }),
    );
    expect(eventRow({ kind: "failed", at: 0, error: "nsfw" }, 0)).toEqual(
      expect.objectContaining({
        label: "failed",
        tone: "failed",
        detail: "nsfw",
      }),
    );
  });

  it("leaves out a payload it cannot print", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(
      eventRow({ kind: "log", at: 0, message: "x", raw: loop }, 0).payload,
    ).toBeUndefined();
    expect(
      eventRow({ kind: "log", at: 0, message: "x" }, 0).payload,
    ).toBeUndefined();
  });
});
