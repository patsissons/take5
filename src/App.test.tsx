import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, listRuns } from "@/lib/history";
import { REPO_URL } from "@/lib/links";
import { clearSettings, getKey } from "@/lib/settings";
import type { JobEvent, VideoProvider } from "@/providers/types";
import App from "./App";

vi.mock("@/lib/thumbnail", () => ({
  captureThumbnail: async () => undefined,
}));

const fake: VideoProvider = vi.hoisted(() => ({
  id: "openrouter",
  label: "FakeRouter",
  keyUrl: "https://keys.example",
  keyHint: "sk-fake",
  hosts: ["api.example"],
  canCancel: false,
  validateKey: vi.fn(async (key: string) => {
    if (key !== "good") throw new Error("Bad key");
    return { label: "test key" };
  }),
  listModels: vi.fn(async () => [
    {
      provider: "openrouter" as const,
      id: "fake/fast",
      name: "Fast",
      frameImages: [],
      referenceImages: false,
      audio: null,
      durations: [5],
      resolutions: null,
      aspectRatios: null,
      sizes: null,
      pricing: null,
    },
  ]),
  submit: vi.fn(async () => ({
    provider: "openrouter" as const,
    id: "job-1",
    model: "fake/fast",
    submittedAt: 0,
  })),
  watch: vi.fn(async function* (): AsyncGenerator<JobEvent> {
    yield { kind: "status", at: 1, status: "queued" };
    yield { kind: "status", at: 2, status: "running" };
    yield { kind: "completed", at: 3, result: { costUsd: 0.05 } };
  }),
  fetchVideo: vi.fn(async () => new Blob(["mp4"], { type: "video/mp4" })),
}));

vi.mock("@/providers", () => ({
  providers: [fake],
  providerById: (id: string) => (id === "openrouter" ? fake : undefined),
}));

beforeEach(() => {
  clearSettings();
  vi.stubGlobal("indexedDB", new IDBFactory());
  resetDb();
});

afterEach(() => vi.clearAllMocks());

describe("App", () => {
  it("renders the name, tagline and the privacy promise", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { level: 1, name: "take5" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Five-second AI videos, straight from your browser."),
    ).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "Your key and videos never leave this browser",
    );
    expect(
      screen.getByRole("link", { name: "Source on GitHub" }),
    ).toHaveAttribute("href", REPO_URL);
  });

  it("walks through setup, then generates a clip and records it", async () => {
    const user = userEvent.setup();
    render(<App />);

    // 1. Provider
    await user.click(screen.getByRole("button", { name: /FakeRouter/ }));

    // 2. Key: rejected, then accepted and remembered
    const keyInput = screen.getByLabelText("API key");
    await user.type(keyInput, "bad");
    await user.click(
      screen.getByRole("button", { name: "Check and continue" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Bad key");
    await user.clear(keyInput);
    await user.type(keyInput, "good");
    await user.click(
      screen.getByRole("button", { name: "Check and continue" }),
    );

    // 3. Model
    await user.click(await screen.findByRole("button", { name: /Fast/ }));
    expect(getKey("openrouter")).toBe("good");
    expect(screen.getByTestId("studio-bar")).toHaveTextContent(
      "FakeRouter · Fast",
    );

    // Generate
    await user.type(screen.getByLabelText("Prompt"), "a corgi");
    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect(fake.submit).toHaveBeenCalledWith(
      "good",
      expect.objectContaining({
        model: "fake/fast",
        prompt: "a corgi",
        duration: 5,
      }),
      expect.anything(),
    );
    const video = await screen.findByTestId("result-video");
    expect(video.getAttribute("src")).toMatch(/^blob:/);
    expect(screen.getByTestId("cost")).toHaveTextContent("Cost $0.05");
    expect(screen.getByText("Done").closest("li")).toHaveTextContent("Done");

    await waitFor(async () =>
      expect(await listRuns()).toEqual([
        expect.objectContaining({
          status: "completed",
          costUsd: 0.05,
          videoBytes: 3,
        }),
      ]),
    );

    // Remix prefills the composer with the same prompt.
    await user.click(screen.getByRole("button", { name: "Remix" }));
    expect(screen.getByLabelText("Prompt")).toHaveValue("a corgi");
    expect(screen.queryByTestId("result-video")).not.toBeInTheDocument();
  });

  it("surfaces a submit failure and lets the visitor retry", async () => {
    const user = userEvent.setup();
    localStorage.setItem("take5:provider", "openrouter");
    localStorage.setItem("take5:key:openrouter", "good");
    localStorage.setItem("take5:model:openrouter", "fake/fast");
    vi.mocked(fake.submit).mockRejectedValueOnce(
      new Error("Insufficient credits"),
    );
    render(<App />);
    await user.type(screen.getByLabelText("Prompt"), "x");
    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Insufficient credits",
    );
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
  });
});
