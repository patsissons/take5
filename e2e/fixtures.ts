import type { Page } from "@playwright/test";
import fixture from "../src/providers/fixtures/openrouter-models.json" with { type: "json" };
import {
  isGenerationModel,
  normalizeModel,
  type OpenRouterModel,
} from "../src/providers/openrouter";

/** A 1x1 PNG for image inputs. */
export const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** Stand-in video bytes; the player gets a blob URL either way. */
export const VIDEO = Buffer.from("not really an mp4 but 24 bytes!!");

export interface OpenRouterStub {
  /** Status answers for successive polls; the last one repeats. */
  polls?: string[];
  validKey?: string;
  /** Every request the page made to the stubbed host. */
  requests: Array<{ method: string; path: string; body?: unknown }>;
}

/** Serves openrouter.ai from fixtures and records what the page sent. */
export async function stubOpenRouter(
  page: Page,
  options: { polls?: string[]; validKey?: string } = {},
): Promise<OpenRouterStub> {
  const stub: OpenRouterStub = {
    polls: options.polls ?? ["pending", "in_progress", "completed"],
    validKey: options.validKey ?? "sk-or-v1-good",
    requests: [],
  };
  let poll = 0;
  await page.route("https://openrouter.ai/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const auth = request.headers()["authorization"];
    const body = request.postDataJSON();
    stub.requests.push({ method: request.method(), path: url.pathname, body });
    const authed = auth === `Bearer ${stub.validKey}`;

    if (url.pathname === "/api/v1/key") {
      return authed
        ? route.fulfill({
            json: { data: { label: "e2e key", limit_remaining: 9 } },
          })
        : route.fulfill({
            status: 401,
            json: { error: { message: "Invalid API key", code: 401 } },
          });
    }
    if (url.pathname === "/api/v1/videos/models") {
      return route.fulfill({ json: fixture });
    }
    if (!authed) {
      return route.fulfill({
        status: 401,
        json: { error: { message: "Invalid API key", code: 401 } },
      });
    }
    if (url.pathname === "/api/v1/videos" && request.method() === "POST") {
      return route.fulfill({
        status: 202,
        json: {
          id: "gen-vid-e2e",
          status: "pending",
          polling_url: "/api/v1/videos/gen-vid-e2e",
        },
      });
    }
    if (url.pathname === "/api/v1/videos/gen-vid-e2e/content") {
      return route.fulfill({ body: VIDEO, contentType: "video/mp4" });
    }
    if (url.pathname === "/api/v1/videos/gen-vid-e2e") {
      const status = stub.polls![Math.min(poll++, stub.polls!.length - 1)]!;
      return route.fulfill({
        json:
          status === "completed"
            ? {
                id: "gen-vid-e2e",
                status,
                unsigned_urls: [
                  "https://openrouter.ai/api/v1/videos/gen-vid-e2e/content",
                ],
                usage: { cost: 0.07 },
              }
            : status === "failed"
              ? { id: "gen-vid-e2e", status, error: "Content blocked" }
              : { id: "gen-vid-e2e", status },
      });
    }
    return route.fulfill({ status: 404, body: "not stubbed" });
  });
  return stub;
}

/** Skips the setup card: a remembered provider, key, model and model list. */
export async function seedSetup(
  page: Page,
  model = "x-ai/grok-imagine-video-1.5-lite",
) {
  const models = (fixture.data as unknown as OpenRouterModel[])
    .filter(isGenerationModel)
    .map(normalizeModel);
  await page.addInitScript(
    ([key, slug, cache]) => {
      localStorage.setItem("take5:provider", "openrouter");
      localStorage.setItem("take5:key:openrouter", key!);
      localStorage.setItem("take5:model:openrouter", slug!);
      localStorage.setItem("take5:models:openrouter", cache!);
    },
    ["sk-or-v1-good", model, JSON.stringify({ at: Date.now(), models })],
  );
}
