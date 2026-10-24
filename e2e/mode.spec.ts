import { expect, test } from "@playwright/test";
import { seedSetup, stubOpenRouter } from "./fixtures";

test("the Image toggle picks a still model first, and each mode keeps its own", async ({
  page,
}) => {
  const stub = await stubOpenRouter(page);
  await seedSetup(page);
  await page.goto("/");
  const modes = page.getByRole("group", { name: "What to make" });
  await expect(modes.getByRole("button", { name: "Video" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // No image model yet: the model step lists OpenRouter's image models.
  await modes.getByRole("button", { name: "Image" }).click();
  await expect(
    page.getByText("Only OpenRouter's image models are listed."),
  ).toBeVisible();
  await expect(page.getByText("Cost per image")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Image Arena Elo" }),
  ).toBeVisible();
  const models = page.getByRole("list", { name: "Models" });
  // Prices come from each model's endpoints.
  await expect(models).toContainText("$0.03/MP");
  await models.getByRole("button", { name: /Grok Imagine Image 2\.0/ }).click();

  await expect(page.getByTestId("studio-bar")).toContainText(
    "OpenRouter · xAI: Grok Imagine Image 2.0",
  );
  await expect(page.getByLabel("Duration")).toHaveCount(0);
  await expect(page.getByLabel("Resolution")).toHaveValue("1K");
  await expect(page.getByTestId("estimate")).toHaveText("About $0.04");
  // The toggle fits the studio bar on a phone too.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(stub.requests.map((r) => r.path)).toContain("/api/v1/images/models");

  // The mode and its model survive a reload.
  await page.reload();
  await expect(modes.getByRole("button", { name: "Image" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("studio-bar")).toContainText(
    "Grok Imagine Image 2.0",
  );

  // Video still has its own model.
  await modes.getByRole("button", { name: "Video" }).click();
  await expect(page.getByTestId("studio-bar")).toContainText(
    "Grok Imagine Video 1.5 Lite",
  );
  await expect(page.getByLabel("Duration")).toHaveValue("5");
});
