import { describe, expect, it } from "vitest";
import { formatBytes } from "./use-history";

describe("formatBytes", () => {
  it("picks a readable unit", () => {
    expect(formatBytes(12_000)).toBe("12 kB");
    expect(formatBytes(2_500_000)).toBe("2.5 MB");
    expect(formatBytes(3_200_000_000)).toBe("3.20 GB");
  });
});
