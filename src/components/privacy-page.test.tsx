import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { allHosts } from "@/providers/hosts";
import { PrivacyPage } from "./privacy-page";

describe("PrivacyPage", () => {
  it("lists every host the CSP allows, grouped by provider", () => {
    render(<PrivacyPage onDeleteEverything={() => {}} />);
    const list = screen.getByRole("list", { name: "Hosts by provider" });
    for (const host of allHosts()) expect(list).toHaveTextContent(host);
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
      "href",
      "#",
    );
  });

  it("offers to delete everything", async () => {
    const onDelete = vi.fn();
    render(<PrivacyPage onDeleteEverything={onDelete} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Delete everything" }),
    );
    expect(onDelete).toHaveBeenCalled();
  });
});
