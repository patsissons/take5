import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Run } from "@/lib/history";
import { HistoryGallery } from "./history-gallery";

const run = (id: string, over: Partial<Run> = {}): Run => ({
  id,
  provider: "openrouter",
  modelName: "Veo",
  request: { model: "m", prompt: `prompt ${id}`, duration: 5, images: [] },
  status: "completed",
  createdAt: 1_700_000_000_000,
  costUsd: 0.1,
  videoBytes: 2_500_000,
  ...over,
});

describe("HistoryGallery", () => {
  it("renders nothing without runs", () => {
    const { container } = render(
      <HistoryGallery
        runs={[]}
        estimate={null}
        onOpen={() => {}}
        onRemix={() => {}}
        onDelete={() => {}}
        onClear={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists runs with their details and the storage meter", async () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    const onRemix = vi.fn();
    render(
      <HistoryGallery
        runs={[
          run("a", { thumbnail: "data:image/jpeg;base64,x" }),
          run("b", { status: "failed" }),
        ]}
        estimate={{ usage: 12_300_000, quota: 1e9 }}
        currentId="a"
        onOpen={onOpen}
        onRemix={onRemix}
        onDelete={onDelete}
        onClear={() => {}}
      />,
    );
    const items = screen
      .getByRole("list", { name: "Past runs" })
      .querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(items[0]).toHaveTextContent("OpenRouter · Veo · 5s");
    expect(items[0]).toHaveTextContent("Done");
    expect(items[0]).toHaveTextContent("$0.10 · 2.5 MB");
    expect(items[1]).toHaveTextContent("Failed");
    expect(screen.getByTestId("storage-meter")).toHaveTextContent(
      "12.3 MB used on this device",
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Open run: prompt a" }),
    );
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Delete run: prompt b" }),
    );
    expect(onDelete).toHaveBeenCalledWith("b");
    await userEvent.click(screen.getAllByRole("button", { name: "Remix" })[1]!);
    expect(onRemix).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
  });

  it("asks before clearing everything", async () => {
    const onClear = vi.fn();
    render(
      <HistoryGallery
        runs={[run("a")]}
        estimate={null}
        onOpen={() => {}}
        onRemix={() => {}}
        onDelete={() => {}}
        onClear={onClear}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClear).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear all" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Really clear 1 runs" }),
    );
    expect(onClear).toHaveBeenCalled();
  });
});
