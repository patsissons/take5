import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSettings, getModelCache, setModelCache } from "@/lib/settings";
import { customModel } from "@/lib/use-settings";
import type { VideoModel, VideoProvider } from "@/providers/types";
import { ModelPicker } from "./model-picker";

const models: VideoModel[] = [
  { ...customModel("openrouter", "a/one"), name: "One", durations: [5] },
  { ...customModel("openrouter", "b/two"), name: "Two", audio: true },
];

function fakeProvider(listModels: VideoProvider["listModels"]): VideoProvider {
  return {
    id: "openrouter",
    label: "OpenRouter",
    keyUrl: "https://x",
    keyHint: "sk",
    hosts: [],
    canCancel: false,
    validateKey: vi.fn(),
    listModels,
    submit: vi.fn(),
    watch: vi.fn(),
    fetchVideo: vi.fn(),
  };
}

beforeEach(() => clearSettings());

describe("ModelPicker", () => {
  it("fetches, caches and lists the models with badges", async () => {
    const listModels = vi.fn(async () => models);
    render(
      <ModelPicker
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
    expect(getModelCache("openrouter")?.models).toHaveLength(2);
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it("starts from the cache and refreshes on demand", async () => {
    setModelCache("openrouter", [models[0]!]);
    const listModels = vi.fn(async () => models);
    render(
      <ModelPicker
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
    setModelCache("openrouter", models);
    const onPick = vi.fn();
    render(
      <ModelPicker
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

  it("accepts a slug that is not listed", async () => {
    setModelCache("openrouter", models);
    const onPick = vi.fn();
    render(
      <ModelPicker
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
    setModelCache("openrouter", models);
    const inspectModel = vi.fn(async (_key: string, model: VideoModel) => ({
      ...model,
      durations: [5, 10],
      extra: { firstFrameField: "image_url" },
    }));
    const onPick = vi.fn();
    render(
      <ModelPicker
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
      getModelCache("openrouter")?.models.find((m) => m.id === "a/one"),
    ).toMatchObject({
      durations: [5, 10],
      extra: { firstFrameField: "image_url" },
    });
  });

  it("reports an inspection failure without picking", async () => {
    setModelCache("openrouter", models);
    const onPick = vi.fn();
    render(
      <ModelPicker
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
});
