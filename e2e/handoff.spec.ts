import { devices, expect, test } from "@playwright/test";
import { seedSetup, stubOpenRouter } from "./fixtures";

// The phone is a second browser context: nothing but the link, the code and
// the file cross over, just as with a real phone.
const { defaultBrowserType: _, ...iPhone } = devices["iPhone 14"];

test("a phone scans the desktop's QR, types the code and gets the setup and history", async ({
  page,
  browser,
}) => {
  await stubOpenRouter(page, { polls: ["completed"] });
  await seedSetup(page);
  await page.goto("/");
  await page.getByLabel("Prompt").fill("handed-off clip");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByTestId("result-video")).toHaveAttribute(
    "src",
    /^blob:/,
    { timeout: 15_000 },
  );

  await page.getByRole("button", { name: "Use on phone" }).click();
  const dialog = page.getByRole("dialog", { name: "Use on your phone" });
  await expect(dialog.getByRole("img", { name: /QR code/ })).toBeVisible();
  await expect(dialog.getByText("sk-or-…good")).toBeVisible();
  const toggle = dialog.getByRole("switch", { name: /history and media/ });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(dialog.getByRole("img", { name: /QR code/ })).toBeVisible();
  const link = await dialog.getByTestId("handoff-qr").getAttribute("data-link");
  const code = await dialog.getByTestId("handoff-code").textContent();
  expect(link).toMatch(/#handoff=[\w-]+$/);
  expect(link).not.toContain("sk-or");
  expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: /Download history file/ }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(
    /^take5-history-\d{4}-\d{2}-\d{2}\.take5$/,
  );
  const file = await download.path();

  const phone = await browser.newContext(iPhone);
  const phonePage = await phone.newPage();
  const phoneStub = await stubOpenRouter(phonePage);
  await phonePage.goto(link!);
  await expect(
    phonePage.getByRole("heading", { name: "Settings from your other device" }),
  ).toBeVisible();
  // The payload leaves the address bar straight away.
  expect(new URL(phonePage.url()).hash).toBe("");

  // A paste (or the keyboard's suggestion) lands in the first box and
  // spreads; typing moves through the boxes by itself.
  const first = phonePage.getByLabel("Character 1 of 8");
  await expect(first).toBeFocused();
  await first.fill("AAAA-AAAA");
  await phonePage.getByRole("button", { name: "Unlock" }).click();
  await expect(phonePage.getByRole("alert")).toContainText("doesn't match");

  await first.click();
  await phonePage.keyboard.type(code!.toLowerCase());
  await expect(phonePage.getByLabel("Character 8 of 8")).toHaveValue(
    code!.slice(-1),
  );
  await phonePage.getByRole("button", { name: "Unlock" }).click();
  await expect(phonePage.getByText("sk-or-…good")).toBeVisible();
  await phonePage.getByRole("button", { name: "Import" }).click();

  await phonePage.getByLabel("History file").setInputFiles(file);
  await expect(phonePage.getByRole("status")).toHaveText("Added 1 run.");
  const gallery = phonePage.getByRole("list", { name: "Past runs" });
  await expect(gallery).toContainText("handed-off clip");
  await phonePage.getByRole("button", { name: "Continue" }).click();

  // The model list stayed on the desktop: the picker fetches it, with the
  // handed-off model already chosen.
  const models = phonePage.getByRole("list", { name: "Models" });
  await models
    .getByRole("button", { name: /Grok Imagine Video 1.5 Lite/ })
    .click();
  await expect(phonePage.getByTestId("studio-bar")).toContainText(
    "OpenRouter · SpaceXAI: Grok Imagine Video 1.5 Lite",
  );
  expect(phoneStub.requests.map((r) => r.path)).toEqual([
    "/api/v1/videos/models",
  ]);
  expect(
    await phonePage.evaluate(() =>
      localStorage.getItem("take5:key:openrouter"),
    ),
  ).toBe("sk-or-v1-good");

  await phonePage
    .getByRole("button", { name: "Open run: handed-off clip" })
    .click();
  await expect(phonePage.getByTestId("result-video")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  const overflow = await phonePage.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await phone.close();
});

test("a reload after the handoff link never asks again", async ({ page }) => {
  await page.goto("/#handoff=AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAh");
  await expect(
    page.getByRole("heading", { name: "Settings from your other device" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Pick a provider" }),
  ).toBeVisible();
});
