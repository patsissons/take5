import { expect, test } from "@playwright/test";
import { allHosts } from "../src/providers/hosts";
import { PIXEL, seedSetup, stubOpenRouter } from "./fixtures";

test("prompt + image → live timeline → video, with no request leaving the allowlist", async ({
  page,
}) => {
  const stub = await stubOpenRouter(page);
  await seedSetup(page);
  const hosts = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    // blob: and data: URLs never leave the page.
    if (url.protocol.startsWith("http")) hosts.add(url.host);
  });

  await page.goto("/");
  await expect(page.getByTestId("studio-bar")).toContainText(
    "Grok Imagine Video 1.5 Lite",
  );
  await expect(page.getByLabel("Duration")).toHaveValue("5");
  await expect(page.getByTestId("estimate")).toHaveText("About $0.15");

  await page.getByLabel("Choose an image").setInputFiles({
    name: "frame.png",
    mimeType: "image/png",
    buffer: PIXEL,
  });
  await expect(page.getByLabel("Image 1 role")).toHaveValue("first_frame");

  await page.getByLabel("Prompt").fill("a corgi surfing");
  await page.getByLabel("Prompt").press("ControlOrMeta+Enter");

  const progress = page.getByRole("region", { name: "Progress" });
  await expect(progress.getByText("Generating")).toBeVisible();
  // Two polls three seconds apart before the stub reports completion.
  const video = page.getByTestId("result-video");
  await expect(video).toHaveAttribute("src", /^blob:/, { timeout: 15_000 });
  await expect(progress.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute(
    "download",
    /^take5-.*\.mp4$/,
  );
  await expect(page.getByTestId("cost")).toContainText("Cost $0.07");

  const submit = stub.requests.find((r) => r.method === "POST");
  expect(submit?.body).toMatchObject({
    model: "x-ai/grok-imagine-video-1.5-lite",
    prompt: "a corgi surfing",
    duration: 5,
    resolution: "720p",
    aspect_ratio: "16:9",
    frame_images: [
      {
        type: "image_url",
        frame_type: "first_frame",
        image_url: { url: expect.stringMatching(/^data:image\/jpeg;base64,/) },
      },
    ],
  });

  const allowed = new Set([...allHosts(), "localhost:5198"]);
  for (const host of hosts) expect(allowed).toContain(host);
});

test("a failed job says why and can be retried", async ({ page }) => {
  await stubOpenRouter(page, { polls: ["failed"] });
  await seedSetup(page);
  await page.goto("/");
  await page.getByLabel("Prompt").fill("x");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByRole("alert")).toHaveText("Content blocked");
  await expect(page.getByRole("button", { name: "Generate" })).toBeEnabled();
});

test("stop watching ends the run without a result", async ({ page }) => {
  await stubOpenRouter(page, { polls: ["pending"] });
  await seedSetup(page);
  await page.goto("/");
  await page.getByLabel("Prompt").fill("x");
  await page.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("button", { name: "Stop watching" }).click();
  await expect(page.getByText("Stopped watching this job.")).toBeVisible();
  await expect(page.getByTestId("result-video")).toHaveCount(0);
});
