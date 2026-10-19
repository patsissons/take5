import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSettings,
  forgetKey,
  getKey,
  getLastModel,
  getModelCache,
  getProvider,
  getRemember,
  setKey,
  setLastModel,
  setModelCache,
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
    expect(getModelCache("fal")).toBeNull();
    setModelCache("fal", []);
    expect(getModelCache("fal")?.at).toBeGreaterThan(0);
    localStorage.setItem("take5:models:fal", "{not json");
    expect(getModelCache("fal")).toBeNull();
  });

  it("clears only its own keys", () => {
    setLastModel("gemini", "veo");
    localStorage.setItem("other", "keep");
    clearSettings();
    expect(getLastModel("gemini")).toBeNull();
    expect(localStorage.getItem("other")).toBe("keep");
  });
});
