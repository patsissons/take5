import { expect, test } from "@playwright/test";
import { seedSetup, stubOpenRouter } from "./fixtures";

test("a reload mid-job picks the job back up and finishes it", async ({
  page,
}) => {
  await stubOpenRouter(page, {
    polls: ["pending", "pending", "pending", "completed"],
  });
  await seedSetup(page);
  await page.goto("/");
  await page.getByLabel("Prompt").fill("slow one");
  await page.getByRole("button", { name: "Generate" }).click();
  // The step is listed from the start; it is current only once the
  // provider has answered a poll, by which time the job is on record.
  await expect(
    page
      .getByRole("region", { name: "Progress" })
      .getByRole("listitem")
      .filter({ hasText: "Queued" }),
  ).toHaveAttribute("aria-current", "step");

  await page.reload();
  await expect(page.getByRole("region", { name: "Progress" })).toBeVisible();
  await expect(page.getByTestId("result-video")).toHaveAttribute(
    "src",
    /^blob:/,
    { timeout: 20_000 },
  );
  await expect(page.getByRole("list", { name: "Past runs" })).toContainText(
    "slow one",
  );
});
