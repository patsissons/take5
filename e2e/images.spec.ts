import { expect, test, type Page } from "@playwright/test";
import { allHosts } from "../src/providers/hosts";
import {
  PIXEL,
  seedProvider,
  stubFal,
  stubGemini,
  stubOpenRouter,
  stubXai,
} from "./fixtures";

/** Every host the page reached, to check against the allowlist. */
function trackHosts(page: Page): Set<string> {
  const hosts = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http")) hosts.add(url.host);
  });
  return hosts;
}

async function addImage(page: Page) {
  await page.getByLabel("Choose an image").setInputFiles({
    name: "ref.png",
    mimeType: "image/png",
    buffer: PIXEL,
  });
  await expect(page.getByLabel("Image 1 role")).toHaveValue("reference");
}

/** The still is shown, named as an image, and kept in history with a thumbnail. */
async function expectStill(page: Page, prompt: string) {
  await expect(page.getByTestId("result-image")).toHaveAttribute(
    "src",
    /^blob:/,
    { timeout: 15_000 },
  );
  await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute(
    "download",
    /^take5-.*\.png$/,
  );
  const gallery = page.getByRole("list", { name: "Past runs" });
  await expect(gallery).toContainText(prompt);
  await expect(gallery).toContainText("Done");
  await expect(
    gallery.getByRole("button", { name: `Open run: ${prompt}` }).locator("img"),
  ).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
}

test("openrouter: a still with a reference comes back in the answer", async ({
  page,
}) => {
  const hosts = trackHosts(page);
  const stub = await stubOpenRouter(page);
  await seedProvider(
    page,
    "openrouter",
    "x-ai/grok-imagine-image-2.0",
    "image",
  );
  await page.goto("/");
  await addImage(page);
  await page.getByLabel("Prompt").fill("a fox in snow");
  await page.getByRole("button", { name: "Generate" }).click();
  await expectStill(page, "a fox in snow");
  await expect(page.getByTestId("cost")).toContainText("Cost $0.04");

  const submit = stub.requests.find((r) => r.method === "POST")!;
  expect(submit.path).toBe("/api/v1/images");
  expect(submit.body).toMatchObject({
    model: "x-ai/grok-imagine-image-2.0",
    prompt: "a fox in snow",
    resolution: "1K",
    aspect_ratio: "1:1",
    input_references: [
      {
        type: "image_url",
        image_url: { url: expect.stringMatching(/^data:image\/jpeg;base64,/) },
      },
    ],
  });
  // Nothing is polled: the image was in the answer.
  expect(stub.requests.some((r) => r.path.startsWith("/api/v1/videos/"))).toBe(
    false,
  );

  const allowed = new Set([...allHosts(), "localhost:5198"]);
  for (const host of hosts) expect(allowed).toContain(host);
});

test("gemini: Nano Banana generates through generateContent", async ({
  page,
}) => {
  const stub = await stubGemini(page);
  await seedProvider(page, "gemini", "gemini-3.1-flash-image", "image");
  await page.goto("/");
  await expect(page.getByTestId("studio-bar")).toContainText(
    "Gemini · Nano Banana 2",
  );
  await expect(page.getByTestId("estimate")).toHaveText("About $0.067");
  await page.getByLabel("Prompt").fill("a lighthouse");
  await page.getByRole("button", { name: "Generate" }).click();
  await expectStill(page, "a lighthouse");

  const submit = stub.requests.find((r) => r.method === "POST")!;
  expect(submit.path).toBe(
    "/v1beta/models/gemini-3.1-flash-image:generateContent",
  );
  expect(submit.body).toMatchObject({
    contents: [{ role: "user", parts: [{ text: "a lighthouse" }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
    },
  });
});

test("xai: Grok Imagine Image asks for base64 and reports the cost", async ({
  page,
}) => {
  const stub = await stubXai(page);
  await seedProvider(page, "xai", "grok-imagine-image-2.0", "image");
  await page.goto("/");
  await expect(page.getByTestId("estimate")).toHaveText("About $0.04");
  await page.getByLabel("Prompt").fill("a desert road");
  await page.getByRole("button", { name: "Generate" }).click();
  await expectStill(page, "a desert road");
  await expect(page.getByTestId("cost")).toContainText("Cost $0.04");

  const submit = stub.requests.find((r) => r.method === "POST")!;
  expect(submit.path).toBe("/v1/images/generations");
  expect(submit.body).toMatchObject({
    model: "grok-imagine-image-2.0",
    prompt: "a desert road",
    response_format: "b64_json",
    resolution: "1k",
    aspect_ratio: "1:1",
  });
});

test("fal: an editor's schema is read on pick and the queue returns the image", async ({
  page,
}) => {
  const stub = await stubFal(page);
  await seedProvider(page, "fal", "fal-ai/nano-banana-2", "image");
  await page.goto("/");
  await page.getByRole("button", { name: "Change model" }).click();
  await page
    .getByRole("list", { name: "Models" })
    .getByRole("button", { name: /fal-ai\/nano-banana-2\/edit/ })
    .click();
  await expect(page.getByLabel("Resolution")).toHaveValue("1K");
  await expect(page.getByTestId("estimate")).toHaveText("About $0.08");
  await addImage(page);
  await page.getByLabel("Prompt").fill("make it night");
  await page.getByRole("button", { name: "Generate" }).click();
  await expectStill(page, "make it night");

  const submit = stub.requests.find((r) => r.method === "POST")!;
  expect(submit.path).toBe("/fal-ai/nano-banana-2/edit");
  expect(submit.body).toMatchObject({
    prompt: "make it night",
    resolution: "1K",
    aspect_ratio: "1:1",
    image_urls: [expect.stringMatching(/^data:image\/jpeg;base64,/)],
  });
});
