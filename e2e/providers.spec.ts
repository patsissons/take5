import { expect, test } from "@playwright/test";
import { seedProvider, stubFal, stubGemini, stubXai } from "./fixtures";

test("fal: pick inspects the model, then the queue streams logs to a result", async ({
  page,
}) => {
  const stub = await stubFal(page);
  await seedProvider(
    page,
    "fal",
    "fal-ai/minimax/hailuo-02/standard/text-to-video",
  );
  await page.goto("/");

  // Picking a model fetches its schema and price, which drive the controls.
  await page.getByRole("button", { name: "Change model" }).click();
  await page
    .getByRole("list", { name: "Models" })
    .getByRole("button", { name: /Kling Video v3/ })
    .click();
  await expect(page.getByTestId("studio-bar")).toContainText(
    "fal · Kling Video v3",
  );
  await expect(page.getByLabel("Duration")).toHaveValue("5");
  await expect(page.getByLabel("Audio")).toBeVisible();
  await expect(page.getByTestId("estimate")).toHaveText("About $0.35");

  await page.getByLabel("Prompt").fill("a corgi");
  await page.getByRole("button", { name: "Generate" }).click();
  const progress = page.getByRole("region", { name: "Progress" });
  await expect(progress.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(page.getByTestId("result-video")).toHaveAttribute(
    "src",
    /^blob:/,
    { timeout: 15_000 },
  );
  await progress.getByText(/Raw events/).click();
  await expect(progress.getByRole("cell", { name: "rendering" })).toBeVisible();

  const submit = stub.requests.find((r) => r.method === "POST")!;
  expect(submit.path).toBe("/fal-ai/kling-video/v3/pro/image-to-video");
  expect(submit.body).toMatchObject({
    prompt: "a corgi",
    duration: "5",
    generate_audio: false,
  });
});

test("fal: a failed queue job reports the error", async ({ page }) => {
  await stubFal(page, { fail: true });
  await seedProvider(
    page,
    "fal",
    "fal-ai/minimax/hailuo-02/standard/text-to-video",
  );
  await page.goto("/");
  await page.getByLabel("Prompt").fill("x");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByRole("alert")).toHaveText("Model crashed");
});

test("gemini: Veo is listed, generated through the operation and downloaded with the key", async ({
  page,
}) => {
  const stub = await stubGemini(page);
  await seedProvider(page, "gemini", "veo-3.1-lite-generate-preview");
  await page.goto("/");
  await expect(page.getByTestId("studio-bar")).toContainText(
    "Gemini (Veo) · Veo 3.1 Lite",
  );
  await expect(page.getByLabel("Duration")).toHaveValue("4");
  await expect(page.getByTestId("estimate")).toHaveText("About $0.20");
  await page.getByLabel("Prompt").fill("a lion");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByTestId("result-video")).toHaveAttribute(
    "src",
    /^blob:/,
    { timeout: 20_000 },
  );
  const submit = stub.requests.find((r) => r.method === "POST")!;
  expect(submit.path).toBe(
    "/v1beta/models/veo-3.1-lite-generate-preview:predictLongRunning",
  );
  expect(submit.body).toMatchObject({
    instances: [{ prompt: "a lion" }],
    parameters: { aspectRatio: "16:9", resolution: "720p", durationSeconds: 4 },
  });
  expect(stub.requests.at(-1)!.path).toContain(":download");
});

test("xai: the setup checks the key, lists models and a job completes", async ({
  page,
}) => {
  const stub = await stubXai(page);
  await page.goto("/");
  await page.getByRole("button", { name: /xAI/ }).click();
  await page.getByLabel("API key", { exact: true }).fill("xai-good");
  await page.getByRole("button", { name: "Check and continue" }).click();
  await page
    .getByRole("list", { name: "Models" })
    .getByRole("button", { name: /Lite/ })
    .click();
  await expect(page.getByTestId("studio-bar")).toContainText(
    "xAI (Grok Imagine) · Grok Imagine Video 1.5 Lite",
  );
  await expect(page.getByTestId("estimate")).toHaveText("About $0.10");
  await page.getByLabel("Prompt").fill("a waterfall");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByTestId("result-video")).toHaveAttribute(
    "src",
    /^blob:/,
    { timeout: 20_000 },
  );
  expect(stub.requests.map((r) => r.path).slice(0, 3)).toEqual([
    "/v1/api-key",
    "/v1/video-generation-models",
    "/v1/videos/generations",
  ]);
});
