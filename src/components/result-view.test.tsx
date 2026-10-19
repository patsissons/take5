import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Run } from "@/lib/history";
import { ResultView } from "./result-view";

const run: Run = {
  id: "abc",
  provider: "openrouter",
  modelName: "M",
  request: { model: "m", prompt: "a corgi", images: [] },
  status: "completed",
  createdAt: 1,
  finishedAt: 72_001,
  costUsd: 0.12,
  videoBytes: 2_400_000,
  videoType: "video/mp4",
};

describe("ResultView", () => {
  it("plays the clip and offers a download with the run's name", () => {
    render(<ResultView run={run} videoUrl="blob:x" onRemix={() => {}} />);
    expect(screen.getByTestId("result-video")).toHaveAttribute("src", "blob:x");
    const download = screen.getByRole("link", { name: "Download" });
    expect(download).toHaveAttribute("href", "blob:x");
    expect(download).toHaveAttribute("download", "take5-abc.mp4");
    expect(screen.getByTestId("cost")).toHaveTextContent(
      "Cost $0.12 · took 1m 12s · 2.4 MB",
    );
  });

  it("copies the prompt and hands the run back for a remix", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const onRemix = vi.fn();
    render(<ResultView run={run} videoUrl="blob:x" onRemix={onRemix} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(writeText).toHaveBeenCalledWith("a corgi");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remix" }));
    expect(onRemix).toHaveBeenCalledWith(run);
  });
});
