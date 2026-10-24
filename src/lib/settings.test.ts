import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSettings,
  forgetKey,
  getKey,
  getLastModel,
  getMode,
  getModelCache,
  getProvider,
  getRemember,
  setKey,
  setLastModel,
  setModelCache,
  setMode,
  setProvider,
  setRemember,
} from "./settings";

beforeEach(() => {
  clearSettings();
  sessionStorage.clear();
});

describe("settings", () => {
  it("remembers the provider and ignores junk", () => {
    expect(getProvider()).toBeNull();
    setProvider("fal");
    expect(getProvider()).toBe("fal");
    localStorage.setItem("take5:provider", "nope");
    expect(getProvider()).toBeNull();
  });

  it("keeps a remembered key in localStorage and a forgotten one in the session", () => {
    expect(getRemember()).toBe(true);
    setKey("openrouter", "sk-1", true);
    expect(localStorage.getItem("take5:key:openrouter")).toBe("sk-1");
    expect(getKey("openrouter")).toBe("sk-1");

    setRemember(false);
    setKey("openrouter", "sk-2", false);
    expect(getRemember()).toBe(false);
    expect(localStorage.getItem("take5:key:openrouter")).toBeNull();
    expect(sessionStorage.getItem("take5:key:openrouter")).toBe("sk-2");
    expect(getKey("openrouter")).toBe("sk-2");

    forgetKey("openrouter");
    expect(getKey("openrouter")).toBeNull();
  });

  it("caches the model list per provider with a timestamp", () => {
    expect(getModelCache("fal", "video")).toBeNull();
    setModelCache("fal", [], "video");
    expect(getModelCache("fal", "video")?.at).toBeGreaterThan(0);
    localStorage.setItem("take5:models:fal", "{not json");
    expect(getModelCache("fal", "video")).toBeNull();
  });

  it("remembers the mode, video unless told otherwise", () => {
    expect(getMode()).toBe("video");
    setMode("image");
    expect(getMode()).toBe("image");
    localStorage.setItem("take5:mode", "sculpture");
    expect(getMode()).toBe("video");
  });

  it("keeps a model and a list per mode, video under the old keys", () => {
    setLastModel("fal", "fal-ai/kling", "video");
    setLastModel("fal", "fal-ai/flux", "image");
    expect(localStorage.getItem("take5:model:fal")).toBe("fal-ai/kling");
    expect(localStorage.getItem("take5:image-model:fal")).toBe("fal-ai/flux");
    expect(getLastModel("fal", "image")).toBe("fal-ai/flux");

    setModelCache("fal", [], "image");
    expect(localStorage.getItem("take5:models:fal")).toBeNull();
    expect(getModelCache("fal", "image")?.models).toEqual([]);
    expect(getModelCache("fal", "video")).toBeNull();
  });

  it("reads a list cached before kinds existed as videos", () => {
    localStorage.setItem(
      "take5:models:xai",
      JSON.stringify({ at: 1, models: [{ id: "grok-imagine-video" }] }),
    );
    expect(getModelCache("xai", "video")?.models[0]).toMatchObject({
      id: "grok-imagine-video",
      kind: "video",
    });
  });

  it("clears only its own keys", () => {
    setLastModel("gemini", "veo", "video");
    localStorage.setItem("other", "keep");
    clearSettings();
    expect(getLastModel("gemini", "video")).toBeNull();
    expect(localStorage.getItem("other")).toBe("keep");
  });
});
