/**
 * Renders the images chat apps and home screens show for take5.lgtm.page:
 * public/og.png (1200x630, the link preview) and public/apple-touch-icon.png
 * (180x180, from public/favicon.svg, its rounded corners left transparent
 * rather than filled with the page's white). The preview is "take5" with a
 * clapperboard beside a strip of video frames.
 *
 *   pnpm og
 */
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const WIDTH = 1200;
const HEIGHT = 630;
const ROOT = path.resolve(import.meta.dirname, "../..");
const FONT = path.join(
  ROOT,
  "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
);

// Palette: the dark oklch tokens from src/index.css.
const C = {
  background: "oklch(0.16 0.02 270)",
  foreground: "oklch(0.97 0.005 270)",
  card: "oklch(0.21 0.025 270)",
  mutedForeground: "oklch(0.72 0.02 270)",
  border: "oklch(1 0 0 / 10%)",
  primary: "oklch(0.83 0.16 75)",
} as const;

/** Frame art hues: one per frame of the strip, a scene warming up. */
const HUES = [290, 250, 200, 120, 60];

const CLAPPER = `<svg viewBox="0 0 24 24" fill="none" stroke="${C.primary}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`;

function frame(hue: number, i: number): string {
  return `<div class="frame">
    <div class="art" style="background:radial-gradient(circle at ${25 + i * 12}% ${30 + i * 8}%, oklch(0.7 0.16 ${hue}), oklch(0.3 0.08 ${hue}))"></div>
  </div>`;
}

async function fontFace(): Promise<string> {
  const font = (await readFile(FONT)).toString("base64");
  return `@font-face { font-family: Geist; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 900; }`;
}

async function ogHtml(): Promise<string> {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  ${await fontFace()}
  * { margin: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body {
    background: ${C.background};
    color: ${C.foreground};
    font-family: Geist, system-ui, sans-serif;
    position: relative;
  }
  .glow {
    position: absolute; inset: 0;
    background:
      radial-gradient(ellipse 560px 360px at 18% 40%, oklch(0.83 0.16 75 / 0.14), transparent 70%),
      radial-gradient(ellipse 700px 500px at 85% 60%, oklch(0.35 0.08 270 / 0.55), transparent 70%);
  }
  .strip {
    position: absolute; right: -60px; top: 140px; width: 760px;
    padding: 26px 0; display: flex; gap: 18px; padding-left: 28px;
    background: ${C.card}; border: 2px solid ${C.border}; border-radius: 28px;
    transform: rotate(-6deg); box-shadow: 0 30px 60px oklch(0 0 0 / 0.45);
  }
  .strip::before, .strip::after {
    content: ""; position: absolute; left: 0; right: 0; height: 12px;
    background: repeating-linear-gradient(90deg, ${C.background} 0 22px, transparent 22px 44px);
    opacity: 0.9;
  }
  .strip::before { top: 8px; }
  .strip::after { bottom: 8px; }
  .frame { width: 212px; height: 150px; border-radius: 12px; overflow: hidden; flex: none; border: 2px solid ${C.border}; }
  .art { width: 100%; height: 100%; }
  header { position: absolute; left: 72px; top: 170px; width: 560px; }
  .mark { width: 120px; height: 120px; margin-bottom: 26px; }
  h1 { font-size: 104px; font-weight: 800; letter-spacing: -0.045em; line-height: 1; }
  p { margin-top: 20px; font-size: 34px; font-weight: 500; color: ${C.mutedForeground}; line-height: 1.25; }
</style></head>
<body>
  <div class="glow"></div>
  <div class="strip">${HUES.map(frame).join("")}</div>
  <header>
    <div class="mark">${CLAPPER}</div>
    <h1>take5</h1>
    <p>Five-second AI videos,<br />straight from your browser.</p>
  </header>
</body></html>`;
}

async function iconHtml(size: number): Promise<string> {
  const svg = await readFile(path.join(ROOT, "public/favicon.svg"), "utf8");
  return `<!doctype html><html><head><style>
    * { margin: 0; }
    html, body { width: ${size}px; height: ${size}px; overflow: hidden; background: transparent; }
    svg { display: block; width: ${size}px; height: ${size}px; }
  </style></head><body>${svg}</body></html>`;
}

async function render(
  file: string,
  html: string,
  width: number,
  height: number,
  transparent = false,
): Promise<void> {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({
    type: "png",
    omitBackground: transparent,
  });
  const out = path.join(ROOT, file);
  await writeFile(out, png);
  console.log(`wrote ${file} (${png.byteLength} bytes)`);
  await page.close();
}

const browser = await chromium.launch();
try {
  await render("public/og.png", await ogHtml(), WIDTH, HEIGHT);
  await render(
    "public/apple-touch-icon.png",
    await iconHtml(180),
    180,
    180,
    true,
  );
} finally {
  await browser.close();
}
