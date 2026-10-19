import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { customModel } from "@/lib/use-settings";
import type { VideoModel } from "@/providers/types";
import { Composer } from "./composer";

const veo: VideoModel = {
  ...customModel("openrouter", "google/veo"),
  name: "Veo",
  audio: true,
  durations: [4, 6, 8],
  resolutions: ["720p", "1080p"],
  aspectRatios: ["16:9", "9:16"],
  pricing: {
    kind: "per-second",
    rates: [
      { usdPerSecond: 0.05, audio: false },
      { usdPerSecond: 0.08, audio: true },
    ],
  },
};

describe("Composer", () => {
  it("builds its controls from the model's capabilities", () => {
    render(<Composer model={veo} busy={false} onGenerate={() => {}} />);
    expect(screen.getByLabelText("Duration")).toHaveValue("4");
    expect(screen.getByLabelText("Resolution")).toHaveValue("720p");
    expect(screen.getByLabelText("Aspect")).toHaveValue("16:9");
    expect(screen.getByLabelText("Audio")).toBeInTheDocument();
    expect(screen.queryByLabelText("Size")).not.toBeInTheDocument();
    expect(screen.getByTestId("estimate")).toHaveTextContent("About $0.20");
  });

  it("falls back to free-form controls for an unlisted model", () => {
    render(
      <Composer
        model={customModel("openrouter", "x/y")}
        busy={false}
        onGenerate={() => {}}
      />,
    );
    expect(screen.getByLabelText("Duration")).toHaveValue(5);
    expect(screen.queryByLabelText("Resolution")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Audio")).not.toBeInTheDocument();
    expect(screen.getByTestId("estimate")).toHaveTextContent(
      "Price not listed",
    );
  });

  it("offers a size picker when the model only lists sizes", () => {
    render(
      <Composer
        model={{
          ...veo,
          resolutions: null,
          aspectRatios: null,
          sizes: ["1280x720"],
        }}
        busy={false}
        onGenerate={() => {}}
      />,
    );
    expect(screen.getByLabelText("Size")).toHaveValue("1280x720");
  });

  it("generates on Cmd+Enter with the neutral request, never without a prompt", async () => {
    const onGenerate = vi.fn();
    render(<Composer model={veo} busy={false} onGenerate={onGenerate} />);
    const button = screen.getByRole("button", { name: "Generate" });
    expect(button).toBeDisabled();

    const prompt = screen.getByLabelText("Prompt");
    await userEvent.type(prompt, "a corgi");
    await userEvent.selectOptions(screen.getByLabelText("Duration"), "8");
    await userEvent.click(screen.getByLabelText("Audio"));
    expect(screen.getByTestId("estimate")).toHaveTextContent("About $0.64");
    await userEvent.type(prompt, "{Meta>}{Enter}{/Meta}");
    expect(onGenerate).toHaveBeenCalledWith({
      model: "google/veo",
      prompt: "a corgi",
      duration: 8,
      resolution: "720p",
      aspectRatio: "16:9",
      size: undefined,
      audio: true,
      images: [],
    });
  });

  it("prefills from a remix", () => {
    render(
      <Composer
        model={veo}
        busy={false}
        initial={{ prompt: "again", duration: 6, audio: true }}
        onGenerate={() => {}}
      />,
    );
    expect(screen.getByLabelText("Prompt")).toHaveValue("again");
    expect(screen.getByLabelText("Duration")).toHaveValue("6");
    expect(screen.getByLabelText("Audio")).toBeChecked();
  });
});
