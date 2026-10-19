import { expect, test } from "@playwright/test";
import { seedSetup, stubOpenRouter } from "./fixtures";

test("first run: provider, key (checked first), then model", async ({
  page,
}) => {
  const stub = await stubOpenRouter(page);
  await page.goto("/");

  await page.getByRole("button", { name: /OpenRouter/ }).click();
  await expect(page.getByRole("link", { name: /Get a key/ })).toHaveAttribute(
    "href",
    "https://openrouter.ai/settings/keys",
  );

  const key = page.getByLabel("API key", { exact: true });
  await key.fill("sk-or-v1-wrong");
  await page.getByRole("button", { name: "Check and continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid API key");

  await key.fill("sk-or-v1-good");
  await page.getByRole("button", { name: "Check and continue" }).click();

  const models = page.getByRole("list", { name: "Models" });
  await expect(models).toBeVisible();
  await expect(models.getByRole("button")).toHaveCount(5);
  await page.getByLabel("Search models").fill("veo");
  await expect(models.getByRole("button")).toHaveCount(1);
  await expect(models.getByText("image→video")).toBeVisible();
  await expect(models.getByText("audio")).toBeVisible();
  await models.getByRole("button", { name: /Veo 3.1 Lite/ }).click();

  await expect(page.getByTestId("studio-bar")).toContainText(
    "OpenRouter · Google: Veo 3.1 Lite",
  );
  expect(stub.requests.map((r) => r.path)).toEqual([
    "/api/v1/key",
    "/api/v1/key",
    "/api/v1/videos/models",
  ]);

  // Remembered: a reload lands in the studio with the key kept on the device.
  await page.reload();
  await expect(page.getByTestId("studio-bar")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("take5:key:openrouter")),
  ).toBe("sk-or-v1-good");

  // Forget key returns to the key step with nothing stored.
  await page.getByRole("button", { name: "Forget key" }).click();
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  expect(
    await page.evaluate(() => localStorage.getItem("take5:key:openrouter")),
  ).toBeNull();
});

test("a key not remembered on the device lives in the session only", async ({
  page,
}) => {
  await stubOpenRouter(page);
  await page.goto("/");
  await page.getByRole("button", { name: /OpenRouter/ }).click();
  await page.getByLabel("API key", { exact: true }).fill("sk-or-v1-good");
  await page.getByLabel("Remember on this device").click();
  await page.getByRole("button", { name: "Check and continue" }).click();
  await expect(page.getByRole("list", { name: "Models" })).toBeVisible();
  expect(
    await page.evaluate(() => [
      localStorage.getItem("take5:key:openrouter"),
      sessionStorage.getItem("take5:key:openrouter"),
    ]),
  ).toEqual([null, "sk-or-v1-good"]);
});

test("changing provider can be cancelled back to the studio", async ({
  page,
}) => {
  await stubOpenRouter(page);
  await seedSetup(page);
  await page.goto("/");
  const bar = page.getByTestId("studio-bar");
  await expect(bar).toContainText("OpenRouter");

  await page.getByRole("button", { name: "Change provider" }).click();
  await page.getByRole("button", { name: /^fal/ }).click();
  await expect(page.getByLabel("API key", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(bar).toContainText("OpenRouter");
  expect(
    await page.evaluate(() => localStorage.getItem("take5:provider")),
  ).toBe("openrouter");

  await page.getByRole("button", { name: "Change model" }).click();
  await expect(page.getByRole("list", { name: "Models" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar).toContainText("OpenRouter");
});
