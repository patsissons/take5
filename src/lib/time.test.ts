import { describe, expect, it } from "vitest";
import { formatElapsed, runDuration } from "./time";

describe("formatElapsed", () => {
  it("shows seconds, then minutes", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(42_900)).toBe("42s");
    expect(formatElapsed(125_000)).toBe("2m 5s");
    expect(formatElapsed(-5)).toBe("0s");
  });
});

describe("runDuration", () => {
  it("formats a finished run and says nothing for one still going", () => {
    expect(runDuration({ createdAt: 1_000, finishedAt: 73_000 })).toBe(
      "1m 12s",
    );
    expect(runDuration({ createdAt: 1_000 })).toBeUndefined();
  });
});
