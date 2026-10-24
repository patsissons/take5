import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSettings,
  setKey,
  setLastModel,
  setModelCache,
  setProvider,
} from "./settings";
import { customModel, resolveModel, useSettings } from "./use-settings";

beforeEach(() => clearSettings());

describe("resolveModel", () => {
  it("returns the cached record when the slug is listed", () => {
    const listed = {
      ...customModel("openrouter", "a/b"),
      name: "Listed",
      audio: true,
    };
    setModelCache("openrouter", [listed], "video");
    expect(resolveModel("openrouter", "a/b", "video")).toEqual(listed);
  });

  it("falls back to a bare record for a hand-typed slug", () => {
    expect(resolveModel("openrouter", "x/y", "video")).toMatchObject({
      id: "x/y",
      name: "x/y",
      durations: null,
      pricing: null,
    });
  });
});

describe("resolveModel for stills", () => {
  it("looks in the image list and makes bare image records", () => {
    const listed = { ...customModel("fal", "flux", "image"), name: "Flux" };
    setModelCache("fal", [listed], "image");
    expect(resolveModel("fal", "flux", "image")).toEqual(listed);
    expect(resolveModel("fal", "flux", "video").kind).toBe("video");
    expect(resolveModel("fal", "typed", "image")).toMatchObject({
      kind: "image",
      frameImages: [],
      referenceImages: true,
    });
  });
});

describe("useSettings", () => {
  it("switches mode with each mode's own remembered model", () => {
    setProvider("fal");
    setKey("fal", "k", true);
    setLastModel("fal", "kling", "video");
    setLastModel("fal", "flux", "image");
    const { result } = renderHook(() => useSettings());
    expect(result.current).toMatchObject({ mode: "video", model: "kling" });

    act(() => result.current.chooseMode("image"));
    expect(result.current).toMatchObject({ mode: "image", model: "flux" });

    act(() => result.current.chooseModel("fal", "seedream", "image"));
    expect(result.current.model).toBe("seedream");

    act(() => result.current.chooseMode("video"));
    expect(result.current).toMatchObject({ mode: "video", model: "kling" });

    act(() => result.current.reset());
    expect(result.current).toMatchObject({ mode: "video", model: null });
  });
});
