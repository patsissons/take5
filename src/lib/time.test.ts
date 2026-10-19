import { describe, expect, it } from "vitest";
import { formatElapsed } from "./time";

describe("formatElapsed", () => {
  it("shows seconds, then minutes", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(42_900)).toBe("42s");
    expect(formatElapsed(125_000)).toBe("2m 5s");
    expect(formatElapsed(-5)).toBe("0s");
  });
});
