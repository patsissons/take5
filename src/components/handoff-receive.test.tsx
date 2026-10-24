import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HANDOFF_TTL_MS, sealHandoff, type HandoffConfig } from "@/lib/handoff";
import { HandoffReceive } from "./handoff-receive";

const config = (history = false): HandoffConfig => ({
  v: 1,
  exp: Date.now() + HANDOFF_TTL_MS,
  provider: "openrouter",
  mode: "video",
  remember: true,
  keys: { openrouter: "sk-or-v1-0123456789abcdef" },
  models: [{ provider: "openrouter", kind: "video", id: "veo" }],
  history,
});

async function setup(history = false, replacing = false) {
  const sealed = await sealHandoff(config(history), "ABCD0123");
  const onApply = vi.fn();
  const onDone = vi.fn();
  const user = userEvent.setup();
  render(
    <HandoffReceive
      sealed={sealed}
      replacing={replacing}
      onApply={onApply}
      onHistoryImported={() => {}}
      onDone={onDone}
    />,
  );
  const input = screen.getByLabelText("Code");
  const unlock = screen.getByRole("button", { name: "Unlock" });
  return { user, input, unlock, onApply, onDone };
}

describe("HandoffReceive", () => {
  it("says so when the code is wrong", async () => {
    const { user, input, unlock, onApply } = await setup();
    expect(unlock).toBeDisabled();
    await user.type(input, "abcd-0124");
    await user.click(unlock);
    expect(
      await screen.findByRole("alert", {}, { timeout: 5000 }),
    ).toHaveTextContent(/doesn't match/);
    expect(onApply).not.toHaveBeenCalled();
  }, 10_000);

  it("previews, warns about replacing, then imports", async () => {
    const { user, input, unlock, onApply, onDone } = await setup(false, true);
    await user.type(input, "abcd 0123");
    await user.click(unlock);
    expect(
      await screen.findByText("sk-or-…cdef", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/replaces the provider/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openrouter" }),
    );
    expect(onDone).toHaveBeenCalled();
  }, 10_000);

  it("asks for the history file when one is on its way", async () => {
    const { user, input, unlock, onDone } = await setup(true);
    await user.type(input, "ABCD0123");
    await user.click(unlock);
    await user.click(
      await screen.findByRole("button", { name: "Import" }, { timeout: 5000 }),
    );
    expect(screen.getByText("Bring your history")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import history file/i }),
    ).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onDone).toHaveBeenCalled();
  }, 10_000);
});
