import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App, { REPO_URL } from "./App";

describe("App", () => {
  it("renders the name, tagline and the privacy promise", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { level: 1, name: "take5" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Five-second AI videos, straight from your browser."),
    ).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "Your key and videos never leave this browser",
    );
  });

  it("links to the source and the privacy explanation", () => {
    render(<App />);
    expect(
      screen.getByRole("link", { name: "Source on GitHub" }),
    ).toHaveAttribute("href", REPO_URL);
    expect(
      screen.getByRole("link", { name: "How that is enforced" }),
    ).toHaveAttribute("href", "#privacy");
  });
});
