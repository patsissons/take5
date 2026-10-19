import { expect, test } from "@playwright/test";
import { allHosts } from "../src/providers/hosts";

/**
 * The privacy promise is enforced by the browser: the Content-Security-Policy
 * served with the page only lets the app talk to the providers' hosts.
 */
test("every response carries the security headers", async ({ request }) => {
  const response = await request.get("/");
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("default-src 'none'");
  for (const host of allHosts()) {
    expect(headers["content-security-policy"]).toContain(`https://${host}`);
  }
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-frame-options"]).toBe("DENY");
});

test("the browser blocks requests to any other host", async ({ page }) => {
  // Deliberately unstubbed: in WebKit a page.route that matches the URL
  // answers before the CSP check runs, which would hide a real leak. If the
  // policy ever stopped working, this fetch would reach the network and
  // resolve instead of throwing.
  await page.goto("/");
  const result = await page.evaluate(() =>
    fetch("https://example.com/collect", { method: "POST", body: "x" }).then(
      () => "sent",
      (error: Error) => `blocked: ${error.name}`,
    ),
  );
  expect(result).toBe("blocked: TypeError");
});

test("the browser lets requests to a provider through", async ({ page }) => {
  await page.route("https://openrouter.ai/**", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.goto("/");
  const result = await page.evaluate(() =>
    fetch("https://openrouter.ai/api/v1/key").then((r) => r.json()),
  );
  expect(result).toEqual({ ok: true });
});
