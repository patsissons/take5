import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QrCode } from "./qr-code";

describe("QrCode", () => {
  it("draws the code as a labelled svg with a quiet zone", () => {
    render(
      <QrCode value="https://take5.lgtm.page/#handoff=abc" label="Scan" />,
    );
    const svg = screen.getByRole("img", { name: "Scan" });
    // Version 3 (29 modules) plus a four-module border each side.
    expect(svg).toHaveAttribute("viewBox", "0 0 37 37");
    const d = svg.querySelector("path")?.getAttribute("d") ?? "";
    expect(d).toMatch(/^M4 4h1v1h-1z/);
    expect(d).not.toMatch(/M[0-3] /);
  });
});
