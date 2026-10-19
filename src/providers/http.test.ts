import { afterEach, describe, expect, it, vi } from "vitest";
import {
  errorMessage,
  parseDataUrl,
  ProviderError,
  request,
  sleep,
} from "./http";

afterEach(() => vi.unstubAllGlobals());

describe("errorMessage", () => {
  it("reads the common envelopes", () => {
    expect(errorMessage({ error: { message: "a" } }, "f")).toBe("a");
    expect(errorMessage({ error: "b" }, "f")).toBe("b");
    expect(errorMessage({ detail: [{ msg: "c" }] }, "f")).toBe("c");
    expect(errorMessage({ message: "d" }, "f")).toBe("d");
    expect(errorMessage("  plain  ", "f")).toBe("plain");
    expect(errorMessage({}, "f")).toBe("f");
    expect(errorMessage("", "f")).toBe("f");
  });
});

describe("request", () => {
  it("never sends a referrer", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("ok"),
    );
    vi.stubGlobal("fetch", fetchMock);
    await request("https://api.example/x");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      referrerPolicy: "no-referrer",
    });
  });

  it("wraps HTTP errors with the server's message and status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("quota", { status: 402 })),
    );
    const error = await request("https://api.example/x").catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({
      message: "quota",
      status: 402,
      body: "quota",
    });
    expect(error.isAuth).toBe(false);
  });

  it("wraps network failures with the host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(request("https://api.example/x")).rejects.toThrow(
      "Could not reach api.example: Failed to fetch",
    );
  });
});

describe("sleep", () => {
  it("rejects with AbortError when the signal fires", async () => {
    const controller = new AbortController();
    const pending = sleep(10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("parseDataUrl", () => {
  it("splits type and payload", () => {
    expect(parseDataUrl("data:image/png;base64,AAAA")).toEqual({
      mimeType: "image/png",
      base64: "AAAA",
    });
    expect(() => parseDataUrl("https://x")).toThrow(ProviderError);
  });
});
