import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSettings, getModelCache, setModelCache } from "@/lib/settings";
import { customModel } from "@/lib/use-settings";
import type { MediaModel, MediaProvider } from "@/providers/types";
import { ModelPicker } from "./model-picker";

const models: MediaModel[] = [
  { ...customModel("openrouter", "a/one"), name: "One", durations: [5] },
  { ...customModel("openrouter", "b/two"), name: "Two", audio: true },
];

function fakeProvider(listModels: MediaProvider["listModels"]): MediaProvider {
  return {
    id: "openrouter",
    label: "OpenRouter",
    keyUrl: "https://x",
    keyHint: "sk",
    hosts: [],
    kinds: ["video"],
    canCancel: false,
    validateKey: vi.fn(),
    listModels,
    submit: vi.fn(),
    watch: vi.fn(),
    fetchMedia: vi.fn(),
  };
}

beforeEach(() => clearSettings());

describe("ModelPicker", () => {
  it("fetches, caches and lists the models with badges", async () => {
    const listModels = vi.fn(async () => models);
    render(
      <ModelPicker
        kind="video"
        provider={fakeProvider(listModels)}
        apiKey="k"
        onPick={() => {}}
      />,
    );
    expect(screen.getByText("Loading models…")).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Models" });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("5s")).toBeInTheDocument();
    expect(screen.getByText("audio")).toBeInTheDocument();
    expect(getModelCache("openrouter", "video")?.models).toHaveLength(2);
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it("starts from the cache and refreshes on demand", async () => {
    setModelCache("openrouter", [models[0]!], "video");
    const listModels = vi.fn(async () => models);
    render(
      <ModelPicker
        kind="video"
        provider={fakeProvider(listModels)}
        apiKey="k"
        onPick={() => {}}
      />,
    );
    expect(
      screen.getByRole("list", { name: "Models" }).querySelectorAll("li"),
    ).toHaveLength(1);
    expect(listModels).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh model list" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("list", { name: "Models" }).querySelectorAll("li"),
      ).toHaveLength(2),
    );
  });

  it("filters by search and picks a model", async () => {
    setModelCache("openrouter", models, "video");
    const onPick = vi.fn();
    render(
      <ModelPicker
        kind="video"
        provider={fakeProvider(vi.fn())}
        apiKey="k"
        onPick={onPick}
      />,
    );
    await userEvent.type(screen.getByLabelText("Search models"), "two");
    expect(screen.queryByText("One")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Two/ }));
    expect(onPick).toHaveBeenCalledWith(models[1]);
  });

  it("ranks models by arena Elo, unranked last, with a badge", () => {
    setModelCache(
      "openrouter",
      [
        ...models,
        {
          ...customModel("openrouter", "google/veo-3.1-lite"),
          name: "Veo 3.1 Lite",
        },
        { ...customModel("openrouter", "alibaba/wan-3.0"), name: "Wan 3.0" },
      ],
      "video",
    );
    render(
      <ModelPicker
        kind="video"
        provider={fakeProvider(vi.fn())}
        apiKey="k"
        onPick={() => {}}
      />,
    );
    const buttons = screen
      .getByRole("list", { name: "Models" })
      .querySelectorAll("button");
    expect([...buttons].map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^Arena Elo1173Wan 3\.0/),
      expect.stringMatching(/^Arena Elo952Veo 3\.1 Lite/),
      expect.stringMatching(/^Onea\/one/),
      expect.stringMatching(/^Twob\/two/),
    ]);
    expect(screen.getByText(/unranked models last/)).toBeInTheDocument();
  });

  it("narrows the list by the cost of a five-second clip", async () => {
    const user = userEvent.setup();
    const at = (id: string, usdPerSecond: number): MediaModel => ({
      ...customModel("openrouter", id),
      pricing: { kind: "per-second", rates: [{ usdPerSecond }] },
    });
    setModelCache(
      "openrouter",
      [
        at("cheap", 0.01),
        at("middle", 0.1),
        {
          ...customModel("openrouter", "flat"),
          pricing: { kind: "per-video", usd: 5 },
        },
        customModel("openrouter", "unpriced"),
      ],
      "video",
    );
    render(
      <ModelPicker
        kind="video"
        provider={fakeProvider(vi.fn())}
        apiKey="k"
        onPick={() => {}}
      />,
    );
    const names = () =>
      [
        ...screen
          .getByRole("list", { name: "Models" })
          .querySelectorAll("button > span:first-child > .font-medium"),
      ].map((el) => el.textContent);
    expect(screen.getByTestId("cost-range")).toHaveTextContent("$0.05 – $5.00");
    expect(names()).toEqual(["cheap", "middle", "flat", "unpriced"]);

    // Pull the top down below $5 and the bottom up past $0.05.
    screen.getByRole("slider", { name: "Highest cost" }).focus();
    await user.keyboard("{PageDown}");
    screen.getByRole("slider", { name: "Lowest cost" }).focus();
    await user.keyboard("{PageUp}");
    expect(names()).toEqual(["middle"]);
    expect(screen.getByText(/Showing 1 of 4/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Any cost" }));
    expect(names()).toEqual(["cheap", "middle", "flat", "unpriced"]);
  });

  it("has no cost slider without two different prices", () => {
    setModelCache("openrouter", models, "video");
    render(
      <ModelPicker
        kind="video"
        provider={fakeProvider(vi.fn())}
        apiKey="k"
        onPick={() => {}}
      />,
    );
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("accepts a slug that is not listed", async () => {
    setModelCache("openrouter", models, "video");
    const onPick = vi.fn();
    render(
      <ModelPicker
        kind="video"
        provider={fakeProvider(vi.fn())}
        apiKey="k"
        onPick={onPick}
      />,
    );
    await userEvent.type(screen.getByLabelText("Model slug"), "c/three");
    await userEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(onPick).toHaveBeenCalledWith(customModel("openrouter", "c/three"));
  });

  it("shows the provider's error", async () => {
    const listModels = vi.fn(async () => {
      throw new Error("nope");
    });
    render(
      <ModelPicker
        kind="video"
        provider={fakeProvider(listModels)}
        apiKey="k"
        onPick={() => {}}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load models: nope",
    );
  });
});

describe("ModelPicker with inspectModel", () => {
  it("fills in a model's details on pick and caches them", async () => {
    setModelCache("openrouter", models, "video");
    const inspectModel = vi.fn(async (_key: string, model: MediaModel) => ({
      ...model,
      durations: [5, 10],
      extra: { firstFrameField: "image_url" },
    }));
    const onPick = vi.fn();
    render(
      <ModelPicker
        kind="video"
        provider={{ ...fakeProvider(vi.fn()), inspectModel }}
        apiKey="k"
        onPick={onPick}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /One/ }));
    expect(inspectModel).toHaveBeenCalledWith("k", models[0]);
    await waitFor(() =>
      expect(onPick).toHaveBeenCalledWith(
        expect.objectContaining({ id: "a/one", durations: [5, 10] }),
      ),
    );
    expect(
      getModelCache("openrouter", "video")?.models.find(
        (m) => m.id === "a/one",
      ),
    ).toMatchObject({
      durations: [5, 10],
      extra: { firstFrameField: "image_url" },
    });
  });

  it("reports an inspection failure without picking", async () => {
    setModelCache("openrouter", models, "video");
    const onPick = vi.fn();
    render(
      <ModelPicker
        kind="video"
        provider={{
          ...fakeProvider(vi.fn()),
          inspectModel: vi.fn(async () => {
            throw new Error("schema down");
          }),
        }}
        apiKey="k"
        onPick={onPick}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /One/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("schema down");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("lists a provider's image models with their own arena and unit cost", async () => {
    const still = (id: string, name: string, usd: number): MediaModel => ({
      ...customModel("openrouter", id, "image"),
      name,
      pricing: { kind: "per-image", rates: [{ usd }] },
    });
    const listModels = vi.fn(async () => [
      still("x/cheap", "Cheap", 0.01),
      still("google/gemini-3-pro-image", "Nano Banana Pro", 0.134),
    ]);
    render(
      <ModelPicker
        kind="image"
        provider={fakeProvider(listModels)}
        apiKey="k"
        onPick={() => {}}
      />,
    );
    const list = await screen.findByRole("list", { name: "Models" });
    expect(listModels).toHaveBeenCalledWith("k", "image");
    // Ranked from the image arena: the Elo puts Nano Banana Pro first.
    expect(list.querySelectorAll("li")[0]).toHaveTextContent(
      "Arena Elo1118Nano Banana Pro",
    );
    expect(screen.getByText("Cost per image")).toBeVisible();
    expect(screen.getByTestId("cost-range")).toHaveTextContent(
      "$0.01 – $0.134",
    );
    expect(
      screen.getByRole("link", { name: "Image Arena Elo" }),
    ).toHaveAttribute(
      "href",
      "https://artificialanalysis.ai/text-to-image/arena/leaderboard-text",
    );
    expect(getModelCache("openrouter", "image")?.models).toHaveLength(2);
    expect(getModelCache("openrouter", "video")).toBeNull();
  });
});
