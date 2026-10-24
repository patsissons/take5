import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyHandoff,
  codeChars,
  collectHandoff,
  formatCode,
  handoffLink,
  HANDOFF_TTL_MS,
  isCompleteCode,
  maskKey,
  newCode,
  normalizeCode,
  openHandoff,
  sealedFromHash,
  sealHandoff,
  type HandoffConfig,
} from "./handoff";
import * as settings from "./settings";

const config = (overrides: Partial<HandoffConfig> = {}): HandoffConfig => ({
  v: 1,
  exp: Date.now() + HANDOFF_TTL_MS,
  provider: "openrouter",
  mode: "video",
  remember: true,
  keys: { openrouter: "sk-or-v1-secret", fal: "fal-key" },
  models: [{ provider: "openrouter", kind: "video", id: "veo" }],
  history: false,
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handoff codes", () => {
  it("makes eight-character codes from the Crockford alphabet", () => {
    const code = newCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(isCompleteCode(code)).toBe(true);
    expect(newCode()).not.toBe(code);
    expect(formatCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });

  it("reads a typed code forgivingly", () => {
    expect(normalizeCode("abcd efgh")).toBe("ABCDEFGH");
    expect(normalizeCode("ABCD-EFGH")).toBe("ABCDEFGH");
    expect(normalizeCode("o0il-1234")).toBe("00111234");
    expect(isCompleteCode("abcd-efg")).toBe(false);
    expect(isCompleteCode("abcd-efgu")).toBe(false);
  });

  it("keeps only code characters from typed or pasted text", () => {
    expect(codeChars("ab-cd ef.gh")).toEqual([..."ABCDEFGH"]);
    expect(codeChars("u!o")).toEqual(["0"]);
    expect(codeChars("")).toEqual([]);
  });
});

describe("sealing", () => {
  it("opens with the code it was sealed with, typed any way", async () => {
    const sealed = await sealHandoff(config(), "ABCD0123");
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("secret");
    expect(await openHandoff(sealed, "abcd-o123")).toEqual({
      ok: true,
      config: config({ exp: expect.any(Number) as number }),
    });
  });

  it("refuses a wrong code, a tampered or truncated link", async () => {
    const sealed = await sealHandoff(config(), "ABCD0123");
    expect(await openHandoff(sealed, "ABCD0124")).toEqual({
      ok: false,
      reason: "code",
    });
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
    expect((await openHandoff(flipped, "ABCD0123")).ok).toBe(false);
    expect(await openHandoff(sealed.slice(0, 20), "ABCD0123")).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await openHandoff("not base64!", "ABCD0123")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("refuses an expired link", async () => {
    const sealed = await sealHandoff(config(), "ABCD0123");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + HANDOFF_TTL_MS + 1000);
    expect(await openHandoff(sealed, "ABCD0123")).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses a payload naming an unknown provider", async () => {
    const bad = config({ provider: "nope" as HandoffConfig["provider"] });
    const sealed = await sealHandoff(bad, "ABCD0123");
    expect(await openHandoff(sealed, "ABCD0123")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});

describe("links", () => {
  it("puts the payload in the fragment of this page's address", () => {
    const location = {
      origin: "https://take5.lgtm.page",
      pathname: "/",
    } as Location;
    expect(handoffLink("abc", location)).toBe(
      "https://take5.lgtm.page/#handoff=abc",
    );
    expect(sealedFromHash("#handoff=abc")).toBe("abc");
    expect(sealedFromHash("#handoff=")).toBeNull();
    expect(sealedFromHash("#privacy")).toBeNull();
  });

  it("masks keys", () => {
    expect(maskKey("sk-or-v1-0123456789abcdef")).toBe("sk-or-…cdef");
    expect(maskKey("short")).toBe("••••");
  });
});

describe("collect and apply", () => {
  it("collects every saved key and both modes' models", () => {
    expect(collectHandoff(false)).toBeNull();
    settings.setProvider("fal");
    settings.setMode("image");
    settings.setRemember(false);
    settings.setKey("fal", "fal-key", false);
    settings.setKey("xai", "xai-key", true);
    settings.setLastModel("fal", "flux", "image");
    settings.setLastModel("openrouter", "veo", "video");
    expect(collectHandoff(true)).toEqual({
      v: 1,
      exp: expect.any(Number) as number,
      provider: "fal",
      mode: "image",
      remember: false,
      keys: { fal: "fal-key", xai: "xai-key" },
      models: [
        { provider: "openrouter", kind: "video", id: "veo" },
        { provider: "fal", kind: "image", id: "flux" },
      ],
      history: true,
    });
  });

  it("applies over this device's settings, keeping other keys", () => {
    settings.setProvider("gemini");
    settings.setKey("gemini", "gem-key", true);
    settings.setKey("openrouter", "old-key", true);
    applyHandoff(
      config({
        mode: "image",
        models: [{ provider: "openrouter", kind: "image", id: "flux" }],
      }),
    );
    expect(settings.getProvider()).toBe("openrouter");
    expect(settings.getMode()).toBe("image");
    expect(settings.getKey("openrouter")).toBe("sk-or-v1-secret");
    expect(settings.getKey("fal")).toBe("fal-key");
    expect(settings.getKey("gemini")).toBe("gem-key");
    expect(settings.getLastModel("openrouter", "image")).toBe("flux");
  });
});
