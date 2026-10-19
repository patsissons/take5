import { beforeEach, describe, expect, it } from "vitest";
import { clearSettings, setModelCache } from "./settings";
import { customModel, resolveModel } from "./use-settings";

beforeEach(() => clearSettings());

describe("resolveModel", () => {
  it("returns the cached record when the slug is listed", () => {
    const listed = {
      ...customModel("openrouter", "a/b"),
      name: "Listed",
      audio: true,
    };
    setModelCache("openrouter", [listed]);
    expect(resolveModel("openrouter", "a/b")).toEqual(listed);
  });

  it("falls back to a bare record for a hand-typed slug", () => {
    expect(resolveModel("openrouter", "x/y")).toMatchObject({
      id: "x/y",
      name: "x/y",
      durations: null,
      pricing: null,
    });
  });
});
