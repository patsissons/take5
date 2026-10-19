import { expect, test } from "@playwright/test";
import { allHosts } from "../src/providers/hosts";
import { seedSetup, stubOpenRouter } from "./fixtures";

test("the privacy page lists every allowed host and nothing else", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "How that is enforced" }).click();
  await expect(page).toHaveURL(/#privacy$/);
  const list = page.getByRole("list", { name: "Hosts by provider" });
  for (const host of allHosts()) await expect(list).toContainText(host);
  const codes = await list.locator("code").allTextContents();
  expect(new Set(codes)).toEqual(new Set(allHosts()));
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByRole("list", { name: "Providers" })).toBeVisible();
});

test("delete everything empties local and session storage and IndexedDB", async ({
  page,
}) => {
  await stubOpenRouter(page, { polls: ["completed"] });
  await seedSetup(page);
  await page.goto("/");
  await page.getByLabel("Prompt").fill("gone soon");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByTestId("result-video")).toHaveAttribute(
    "src",
    /^blob:/,
    { timeout: 15_000 },
  );

  await page.getByRole("button", { name: "Delete everything" }).click();
  await page
    .getByRole("button", { name: "Really delete keys, settings and videos" })
    .click();
  await expect(page.getByRole("list", { name: "Providers" })).toBeVisible();
  const state = await page.evaluate(async () => ({
    local: Object.keys(localStorage).filter((k) => k.startsWith("take5:")),
    session: Object.keys(sessionStorage).filter((k) => k.startsWith("take5:")),
    databases: (await indexedDB.databases()).map((db) => db.name),
  }));
  expect(state.local).toEqual([]);
  expect(state.session).toEqual([]);
  expect(state.databases).not.toContain("take5");
  await page.reload();
  await expect(page.getByRole("list", { name: "Providers" })).toBeVisible();
});
