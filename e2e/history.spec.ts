import { expect, test } from "@playwright/test";
import { seedSetup, stubOpenRouter } from "./fixtures";

test("a finished run lands in the gallery, survives a reload, reopens, remixes and deletes", async ({
  page,
}) => {
  await stubOpenRouter(page, { polls: ["completed"] });
  await seedSetup(page);
  await page.goto("/");
  await page.getByLabel("Prompt").fill("first clip");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByTestId("result-video")).toHaveAttribute(
    "src",
    /^blob:/,
    { timeout: 15_000 },
  );

  const gallery = page.getByRole("list", { name: "Past runs" });
  await expect(gallery.getByRole("listitem")).toHaveCount(1);
  await expect(gallery).toContainText("first clip");
  await expect(gallery).toContainText("Done");
  await expect(page.getByTestId("storage-meter")).toBeVisible();

  // The run and its video are kept on the device.
  await page.reload();
  await expect(gallery.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Open run: first clip" }).click();
  await expect(page.getByTestId("result-video")).toHaveAttribute(
    "src",
    /^blob:/,
  );

  // Remix prefills the composer.
  await gallery.getByRole("button", { name: "Remix" }).click();
  await expect(page.getByLabel("Prompt")).toHaveValue("first clip");

  await page.getByRole("button", { name: "Delete run: first clip" }).click();
  await expect(gallery).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("list", { name: "Past runs" })).toHaveCount(0);
});
