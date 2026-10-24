import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, listRuns } from "@/lib/history";
import { REPO_URL } from "@/lib/links";
import { clearSettings, getKey, setModelCache } from "@/lib/settings";
import type { JobEvent, MediaProvider } from "@/providers/types";
import App from "./App";

vi.mock("@/lib/thumbnail", () => ({
  captureThumbnail: async () => undefined,
}));

const fake: MediaProvider = vi.hoisted(() => ({
  id: "openrouter",
  label: "FakeRouter",
  keyUrl: "https://keys.example",
  keyHint: "sk-fake",
  hosts: ["api.example"],
  kinds: ["video", "image"],
  answersAtSubmit: ["image"],
  canCancel: false,
  validateKey: vi.fn(async (key: string) => {
    if (key !== "good") throw new Error("Bad key");
    return { label: "test key" };
  }),
  listModels: vi.fn(async (_key: string, kind: "video" | "image") =>
    kind === "image"
      ? [
          {
            provider: "openrouter" as const,
            kind: "image" as const,
            id: "fake/still",
            name: "Still",
            frameImages: [],
            referenceImages: true,
            audio: null,
            durations: null,
            resolutions: ["1K", "2K"],
            aspectRatios: ["16:9", "1:1"],
            sizes: null,
            pricing: { kind: "per-image" as const, rates: [{ usd: 0.04 }] },
          },
        ]
      : [
          {
            provider: "openrouter" as const,
            kind: "video" as const,
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
        ],
  ),
  submit: vi.fn(async (_key: string, req: { kind?: string; model: string }) =>
    req.kind === "image"
      ? {
          provider: "openrouter" as const,
          id: "image-1",
          model: req.model,
          submittedAt: 0,
          answer: {
            kind: "completed" as const,
            at: 3,
            result: {
              costUsd: 0.04,
              media: new Blob(["png"], { type: "image/png" }),
            },
          },
        }
      : {
          provider: "openrouter" as const,
          id: "job-1",
          model: "fake/fast",
          submittedAt: 0,
        },
  ),
  watch: vi.fn(async function* (): AsyncGenerator<JobEvent> {
    yield { kind: "status", at: 1, status: "queued" };
    yield { kind: "status", at: 2, status: "running" };
    yield { kind: "completed", at: 3, result: { costUsd: 0.05 } };
  }),
  fetchMedia: vi.fn(async () => new Blob(["mp4"], { type: "video/mp4" })),
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
      screen.getByText(
        "Five-second AI videos and stills, straight from your browser.",
      ),
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
    await user.click(
      within(screen.getByRole("region", { name: "Result" })).getByRole(
        "button",
        {
          name: "Remix",
        },
      ),
    );
    expect(screen.getByLabelText("Prompt")).toHaveValue("a corgi");
    expect(screen.queryByTestId("result-video")).not.toBeInTheDocument();
  });

  it("backs out of Change model and Change provider without changes", async () => {
    const user = userEvent.setup();
    localStorage.setItem("take5:provider", "openrouter");
    localStorage.setItem("take5:key:openrouter", "good");
    localStorage.setItem("take5:model:openrouter", "fake/fast");
    setModelCache(
      "openrouter",
      await fake.listModels("good", "video"),
      "video",
    );
    render(<App />);
    expect(screen.getByTestId("studio-bar")).toHaveTextContent(
      "FakeRouter · Fast",
    );

    await user.click(screen.getByRole("button", { name: "Change model" }));
    expect(await screen.findByRole("list", { name: "Models" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("studio-bar")).toHaveTextContent(
      "FakeRouter · Fast",
    );

    await user.click(screen.getByRole("button", { name: "Change provider" }));
    await user.click(screen.getByRole("button", { name: /FakeRouter/ }));
    expect(screen.getByLabelText("API key")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("studio-bar")).toHaveTextContent(
      "FakeRouter · Fast",
    );
    expect(getKey("openrouter")).toBe("good");
  });

  it("switches to images, picks a still model first, and remembers each mode's model", async () => {
    const user = userEvent.setup();
    localStorage.setItem("take5:provider", "openrouter");
    localStorage.setItem("take5:key:openrouter", "good");
    localStorage.setItem("take5:model:openrouter", "fake/fast");
    setModelCache(
      "openrouter",
      await fake.listModels("good", "video"),
      "video",
    );
    render(<App />);
    const modes = screen.getByRole("group", { name: "What to make" });
    expect(
      within(modes).getByRole("button", { name: "Video" }),
    ).toHaveAttribute("aria-pressed", "true");

    // No image model yet: the model step comes first, listing stills.
    await user.click(within(modes).getByRole("button", { name: "Image" }));
    expect(
      screen.getByText("Only FakeRouter's image models are listed."),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Still/ }));
    expect(fake.listModels).toHaveBeenLastCalledWith("good", "image");
    expect(screen.getByTestId("studio-bar")).toHaveTextContent(
      "FakeRouter · Still",
    );
    expect(screen.queryByLabelText("Duration")).not.toBeInTheDocument();
    expect(screen.getByTestId("estimate")).toHaveTextContent("About $0.04");

    await user.type(screen.getByLabelText("Prompt"), "a fox");
    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect(fake.submit).toHaveBeenLastCalledWith(
      "good",
      expect.objectContaining({ kind: "image", model: "fake/still" }),
      expect.anything(),
    );
    const image = await screen.findByTestId("result-image");
    expect(image.getAttribute("src")).toMatch(/^blob:/);
    expect(fake.watch).not.toHaveBeenCalled();
    await waitFor(async () =>
      expect(await listRuns()).toEqual([
        expect.objectContaining({
          status: "completed",
          videoType: "image/png",
        }),
      ]),
    );

    // Back to video: its model is still there; then images again, no picking.
    await user.click(
      within(screen.getByRole("group", { name: "What to make" })).getByRole(
        "button",
        { name: "Video" },
      ),
    );
    expect(screen.getByTestId("studio-bar")).toHaveTextContent(
      "FakeRouter · Fast",
    );
    expect(screen.getByLabelText("Duration")).toBeInTheDocument();

    // Remixing the still switches back to images.
    const runs = await screen.findByRole("list", { name: "Past runs" });
    await user.click(within(runs).getByRole("button", { name: "Remix" }));
    expect(screen.getByTestId("studio-bar")).toHaveTextContent(
      "FakeRouter · Still",
    );
    expect(screen.getByLabelText("Prompt")).toHaveValue("a fox");
  });

  it("backs out of a switch to a mode with no model yet", async () => {
    const user = userEvent.setup();
    localStorage.setItem("take5:provider", "openrouter");
    localStorage.setItem("take5:key:openrouter", "good");
    localStorage.setItem("take5:model:openrouter", "fake/fast");
    setModelCache(
      "openrouter",
      await fake.listModels("good", "video"),
      "video",
    );
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Image" }));
    expect(await screen.findByRole("list", { name: "Models" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("studio-bar")).toHaveTextContent(
      "FakeRouter · Fast",
    );
    expect(screen.getByRole("button", { name: "Video" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("offers no way out of the first-run setup", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("list", { name: "Providers" })).toBeInTheDocument();
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

describe("App history, resume and delete everything", () => {
  const seed = () => {
    localStorage.setItem("take5:provider", "openrouter");
    localStorage.setItem("take5:key:openrouter", "good");
    localStorage.setItem("take5:model:openrouter", "fake/fast");
  };

  it("resumes a run that was in flight and lists it when done", async () => {
    seed();
    const { putRun } = await import("@/lib/history");
    await putRun({
      id: "r-1",
      provider: "openrouter",
      modelName: "Fast",
      request: { model: "fake/fast", prompt: "resumed", images: [] },
      status: "running",
      createdAt: Date.now() - 10_000,
      job: {
        provider: "openrouter",
        id: "job-1",
        model: "fake/fast",
        submittedAt: 0,
      },
    });
    render(<App />);
    expect(await screen.findByTestId("result-video")).toBeInTheDocument();
    expect(fake.watch).toHaveBeenCalledWith(
      "good",
      expect.objectContaining({ id: "job-1" }),
      expect.anything(),
    );
    const list = await screen.findByRole("list", { name: "Past runs" });
    expect(list).toHaveTextContent("resumed");
    await waitFor(() => expect(list).toHaveTextContent("Done"));
  });

  it("deletes everything: keys, settings and runs", async () => {
    const user = userEvent.setup();
    seed();
    const { putRun } = await import("@/lib/history");
    await putRun({
      id: "r-2",
      provider: "openrouter",
      modelName: "Fast",
      request: { model: "fake/fast", prompt: "old", images: [] },
      status: "completed",
      createdAt: 1,
    });
    render(<App />);
    expect(
      await screen.findByRole("list", { name: "Past runs" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete everything" }));
    await user.click(
      screen.getByRole("button", {
        name: "Really delete keys, settings and videos",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("list", { name: "Past runs" }),
      ).not.toBeInTheDocument(),
    );
    expect(getKey("openrouter")).toBeNull();
    expect(screen.getByRole("list", { name: "Providers" })).toBeInTheDocument();
    expect(await listRuns()).toEqual([]);
  });

  it("shows the privacy page at #privacy", async () => {
    window.location.hash = "#privacy";
    render(<App />);
    expect(
      screen.getByRole("heading", {
        name: "What leaves this browser, and what stays",
      }),
    ).toBeInTheDocument();
    window.location.hash = "";
  });
});
