import { expect, test } from "@playwright/test";

/** Chat apps unfurl links from the meta tags and fetch the image. */
test("the page carries Open Graph tags and serves the preview image", async ({
  request,
}) => {
  const home = await request.get("/");
  expect(home.ok()).toBe(true);
  const html = await home.text();
  const image = html.match(/property="og:image" content="([^"]+)"/)?.[1];
  expect(image).toBe("https://take5.lgtm.page/og.png");
  expect(html).toContain('name="twitter:card" content="summary_large_image"');

  const png = await request.get("/og.png");
  expect(png.ok()).toBe(true);
  expect(png.headers()["content-type"]).toContain("image/png");
  const bytes = await png.body();
  // PNG signature, then the IHDR chunk: width and height as big-endian u32.
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(bytes.readUInt32BE(16)).toBe(1200);
  expect(bytes.readUInt32BE(20)).toBe(630);

  for (const icon of ["/favicon.svg", "/apple-touch-icon.png"]) {
    expect((await request.get(icon)).ok()).toBe(true);
  }
});

test("the home-screen icon's rounded corners are transparent", async ({
  page,
}) => {
  await page.goto("/");
  const alpha = await page.evaluate(async () => {
    const img = new Image();
    img.src = "/apple-touch-icon.png";
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(img, 0, 0);
    const at = (x: number, y: number) =>
      context.getImageData(x, y, 1, 1).data[3];
    const last = img.naturalWidth - 1;
    return {
      size: [img.naturalWidth, img.naturalHeight],
      corners: [at(0, 0), at(last, 0), at(0, last), at(last, last)],
      middle: at(img.naturalWidth / 2, img.naturalHeight / 2),
    };
  });
  expect(alpha).toEqual({
    size: [180, 180],
    corners: [0, 0, 0, 0],
    middle: 255,
  });
});
