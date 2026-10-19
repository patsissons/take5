import { expect, test } from "@playwright/test";

test("the home page shows the name, the promise and the source link", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "take5" }),
  ).toBeVisible();
  await expect(page.getByRole("note")).toContainText(
    "never leave this browser",
  );
  await expect(
    page.getByRole("link", { name: "Source on GitHub" }),
  ).toHaveAttribute("href", "https://github.com/patsissons/take5");
});

test("the page never scrolls sideways", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
