import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openHandoff, sealedFromHash } from "@/lib/handoff";
import type { Run } from "@/lib/history";
import * as settings from "@/lib/settings";
import { HandoffDialog } from "./handoff-dialog";

const run = (id: string, over: Partial<Run> = {}): Run => ({
  id,
  provider: "openrouter",
  modelName: "Veo",
  request: { model: "m", prompt: `prompt ${id}`, images: [] },
  status: "completed",
  createdAt: 1,
  videoBytes: 2_500_000,
  ...over,
});

function seed() {
  settings.setProvider("openrouter");
  settings.setKey("openrouter", "sk-or-v1-0123456789abcdef", true);
  settings.setLastModel("openrouter", "veo", "video");
}

async function openDialog(runs: Run[] = []) {
  seed();
  const user = userEvent.setup();
  render(<HandoffDialog runs={runs} onHistoryImported={() => {}} />);
  await user.click(screen.getByRole("button", { name: /use on phone/i }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByRole(
    "img",
    { name: /qr code/i },
    { timeout: 5000 },
  );
  return { user, dialog };
}

describe("HandoffDialog", () => {
  it("shows a QR whose link opens with the code beside it", async () => {
    const { dialog } = await openDialog();
    const code = within(dialog).getByTestId("handoff-code").textContent ?? "";
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const link = within(dialog)
      .getByTestId("handoff-qr")
      .getAttribute("data-link");
    expect(link).toMatch(/^http:\/\/localhost(:\d+)?\/#handoff=/);
    expect(link).not.toContain("sk-or");
    const sealed = sealedFromHash(new URL(link!).hash)!;
    const opened = await openHandoff(sealed, code);
    expect(opened).toMatchObject({
      ok: true,
      config: {
        provider: "openrouter",
        keys: { openrouter: "sk-or-v1-0123456789abcdef" },
        history: false,
      },
    });
    expect(within(dialog).getByText("sk-or-…cdef")).toBeInTheDocument();
  }, 10_000);

  it("leaves history behind unless asked, then offers its file", async () => {
    const { user, dialog } = await openDialog([
      run("a"),
      run("b", { status: "running" }),
    ]);
    const toggle = within(dialog).getByRole("switch", {
      name: /history and media/i,
    });
    expect(toggle).not.toBeChecked();
    expect(
      within(dialog).queryByRole("button", { name: /download history/i }),
    ).not.toBeInTheDocument();

    await user.click(toggle);
    expect(
      within(dialog).getByRole("button", {
        name: "Download history file (1 run · 2.5 MB)",
      }),
    ).toBeInTheDocument();
    // The link is sealed again, now saying a file is coming.
    await within(dialog).findByRole(
      "img",
      { name: /qr code/i },
      { timeout: 5000 },
    );
    const code = within(dialog).getByTestId("handoff-code").textContent ?? "";
    const link = within(dialog)
      .getByTestId("handoff-qr")
      .getAttribute("data-link")!;
    const opened = await openHandoff(sealedFromHash(new URL(link).hash)!, code);
    expect(opened).toMatchObject({ ok: true, config: { history: true } });
  }, 15_000);
});
