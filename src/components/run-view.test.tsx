import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RunState } from "@/lib/use-run";
import { RunView } from "./run-view";

const state = (over: Partial<RunState>): RunState => ({
  run: {
    id: "r",
    provider: "openrouter",
    modelName: "M",
    request: { model: "m", prompt: "p", images: [] },
    status: "running",
    createdAt: Date.now() - 65_000,
  },
  events: [],
  status: "running",
  ...over,
});

describe("RunView", () => {
  it("marks the active step and counts elapsed time", () => {
    render(
      <RunView
        state={state({ status: "queued", queuePosition: 3 })}
        canCancel={false}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Queued").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByText("#3")).toBeInTheDocument();
    expect(screen.getByTestId("elapsed")).toHaveTextContent("1m 5s");
    expect(
      screen.getByRole("button", { name: "Stop watching" }),
    ).toBeInTheDocument();
  });

  it("shows the failure on the step it died in", () => {
    render(
      <RunView
        state={state({
          status: "failed",
          error: "nsfw",
          events: [
            { kind: "status", at: 1, status: "submitted" },
            { kind: "status", at: 2, status: "running" },
            { kind: "failed", at: 3, error: "nsfw" },
          ],
        })}
        canCancel
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("nsfw");
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Raw events (3)")).toBeInTheDocument();
  });

  it("offers a real cancel when the provider supports it", async () => {
    const onCancel = vi.fn();
    render(<RunView state={state({})} canCancel onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
