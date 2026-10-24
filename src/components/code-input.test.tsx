import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CodeInput } from "./code-input";

function Harness() {
  const [chars, setChars] = useState<string[]>(Array(8).fill(""));
  return (
    <>
      <span id="label">Code</span>
      <CodeInput labelledBy="label" value={chars} onChange={setChars} />
      <output>{chars.map((c) => c || "_").join("")}</output>
    </>
  );
}

const box = (n: number) => screen.getByLabelText(`Character ${n} of 8`);
const typed = () => screen.getByRole("status").textContent;

describe("CodeInput", () => {
  it("is eight boxes in two groups of four", () => {
    render(<Harness />);
    const group = screen.getByRole("group", { name: "Code" });
    expect(group.querySelectorAll("input")).toHaveLength(8);
    expect(group.children[4]).toHaveTextContent("-");
    expect(box(1)).toHaveFocus();
  });

  it("moves on as you type, skipping what isn't a code character", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard("ab-c!d");
    expect(typed()).toBe("ABCD____");
    expect(box(5)).toHaveFocus();
    await user.keyboard("efgho");
    expect(typed()).toBe("ABCDEFG0");
    expect(box(8)).toHaveFocus();
  });

  it("moves back as you delete", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard("abc");
    await user.keyboard("{Backspace}");
    expect(typed()).toBe("AB______");
    expect(box(3)).toHaveFocus();
    await user.keyboard("{Backspace}");
    expect(typed()).toBe("A_______");
    expect(box(2)).toHaveFocus();
  });

  it("replaces a character you go back to, and arrows move", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard("abcd");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(box(3)).toHaveFocus();
    await user.keyboard("z");
    expect(typed()).toBe("ABZD____");
    expect(box(4)).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(box(5)).toHaveFocus();
  });

  it("spreads a paste from the box it lands in", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box(2));
    await user.paste("wxyz-1234");
    expect(typed()).toBe("_WXYZ123");
    expect(box(8)).toHaveFocus();
  });
});
