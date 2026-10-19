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

import falList from "../src/providers/fixtures/fal-models.json" with { type: "json" };
import falKling from "../src/providers/fixtures/fal-openapi-kling.json" with { type: "json" };
import {
  normalizeModel as normalizeFal,
  type FalModel,
} from "../src/providers/fal";
import { normalizeModel as normalizeGemini } from "../src/providers/gemini";
import { normalizeModel as normalizeXai } from "../src/providers/xai";
import type { ProviderId } from "../src/providers/hosts";
import type { VideoModel } from "../src/providers/types";

const KEYS: Record<ProviderId, string> = {
  openrouter: "sk-or-v1-good",
  fal: "id:secret",
  gemini: "AIza-good",
  xai: "xai-good",
};

/** Serves fal's platform API, queue and media CDN. */
export async function stubFal(page: Page, options: { fail?: boolean } = {}) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const record = (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    const request = route.request();
    requests.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: request.postDataJSON(),
    });
    return request.headers()["authorization"] === `Key ${KEYS.fal}`;
  };
  await page.route("https://api.fal.ai/**", (route) => {
    const authed = record(route);
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/models/pricing") {
      return authed
        ? route.fulfill({
            json: {
              prices: [
                {
                  endpoint_id: "x",
                  unit_price: 0.07,
                  unit: "video_second",
                  currency: "USD",
                },
              ],
            },
          })
        : route.fulfill({
            status: 401,
            json: { detail: "invalid key credentials" },
          });
    }
    if (url.searchParams.get("expand"))
      return route.fulfill({ json: falKling });
    return route.fulfill({ json: falList });
  });
  await page.route("https://queue.fal.run/**", (route) => {
    const authed = record(route);
    if (!authed)
      return route.fulfill({
        status: 401,
        json: { detail: "invalid key credentials" },
      });
    const url = new URL(route.request().url());
    const base = "https://queue.fal.run/fal-ai/kling-video/requests/req-e2e";
    if (route.request().method() === "POST") {
      return route.fulfill({
        json: {
          request_id: "req-e2e",
          status_url: `${base}/status`,
          response_url: base,
          cancel_url: `${base}/cancel`,
        },
      });
    }
    if (url.pathname.endsWith("/status/stream")) {
      const events = [
        { status: "IN_QUEUE", request_id: "req-e2e", queue_position: 1 },
        {
          status: "IN_PROGRESS",
          request_id: "req-e2e",
          logs: [{ message: "rendering" }],
        },
        options.fail
          ? {
              status: "COMPLETED",
              request_id: "req-e2e",
              error: "Model crashed",
              error_type: "x",
            }
          : {
              status: "COMPLETED",
              request_id: "req-e2e",
              logs: [{ message: "rendering" }],
            },
      ];
      return route.fulfill({
        contentType: "text/event-stream",
        body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
      });
    }
    if (url.pathname.endsWith("/cancel"))
      return route.fulfill({
        status: 202,
        json: { status: "CANCELLATION_REQUESTED" },
      });
    return route.fulfill({
      json: {
        video: {
          url: "https://v3.fal.media/files/e2e/video.mp4",
          content_type: "video/mp4",
        },
      },
    });
  });
  await page.route("https://*.fal.media/**", (route) =>
    route.fulfill({ body: VIDEO, contentType: "video/mp4" }),
  );
  return { requests };
}

/** Serves the Gemini models list, the Veo operation and the file download. */
export async function stubGemini(page: Page) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  let polls = 0;
  await page.route("https://generativelanguage.googleapis.com/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({
      method: request.method(),
      path: url.pathname,
      body: request.postDataJSON(),
    });
    if (request.headers()["x-goog-api-key"] !== KEYS.gemini) {
      return route.fulfill({
        status: 400,
        json: { error: { message: "API key not valid", code: 400 } },
      });
    }
    if (url.pathname === "/v1beta/models") {
      return route.fulfill({
        json: {
          models: [
            {
              name: "models/gemini-2.5-pro",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/veo-3.1-lite-generate-preview",
              displayName: "Veo 3.1 Lite",
              supportedGenerationMethods: ["predictLongRunning"],
            },
          ],
        },
      });
    }
    if (url.pathname.endsWith(":predictLongRunning")) {
      return route.fulfill({
        json: {
          name: "models/veo-3.1-lite-generate-preview/operations/op-e2e",
        },
      });
    }
    if (url.pathname.endsWith("/operations/op-e2e")) {
      polls++;
      return route.fulfill({
        json:
          polls < 2
            ? { name: "op", done: false }
            : {
                name: "op",
                done: true,
                response: {
                  generateVideoResponse: {
                    generatedSamples: [
                      {
                        video: {
                          uri: "https://generativelanguage.googleapis.com/v1beta/files/e2e:download?alt=media",
                        },
                      },
                    ],
                  },
                },
              },
      });
    }
    if (url.pathname.endsWith(":download"))
      return route.fulfill({ body: VIDEO, contentType: "video/mp4" });
    return route.fulfill({ status: 404, body: "not stubbed" });
  });
  return { requests };
}

/** Serves xAI's key check, model list, generation and video host. */
export async function stubXai(page: Page) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  let polls = 0;
  await page.route("https://api.x.ai/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({
      method: request.method(),
      path: url.pathname,
      body: request.postDataJSON(),
    });
    if (request.headers()["authorization"] !== `Bearer ${KEYS.xai}`) {
      return route.fulfill({
        status: 400,
        json: {
          code: "invalid-argument",
          error: "Incorrect API key provided.",
        },
      });
    }
    if (url.pathname === "/v1/api-key")
      return route.fulfill({ json: { name: "e2e" } });
    if (url.pathname === "/v1/video-generation-models") {
      return route.fulfill({
        json: {
          models: [
            { id: "grok-imagine-video-1.5-lite" },
            { id: "grok-imagine-video" },
          ],
        },
      });
    }
    if (url.pathname === "/v1/videos/generations")
      return route.fulfill({ json: { request_id: "req-e2e" } });
    if (url.pathname === "/v1/videos/req-e2e") {
      polls++;
      return route.fulfill({
        json:
          polls < 2
            ? { status: "pending" }
            : {
                status: "done",
                video: {
                  url: "https://vidgen.x.ai/e2e/video.mp4",
                  duration: 5,
                },
              },
      });
    }
    return route.fulfill({ status: 404, body: "not stubbed" });
  });
  await page.route("https://vidgen.x.ai/**", (route) =>
    route.fulfill({ body: VIDEO, contentType: "video/mp4" }),
  );
  return { requests };
}

/** The cached model list each stub serves, as the app would normalise it. */
export function seededModels(provider: ProviderId): VideoModel[] {
  switch (provider) {
    case "fal":
      return (falList.models as FalModel[]).map(normalizeFal);
    case "gemini":
      return [
        normalizeGemini({
          name: "models/veo-3.1-lite-generate-preview",
          displayName: "Veo 3.1 Lite",
          supportedGenerationMethods: ["predictLongRunning"],
        }),
      ];
    case "xai":
      return [
        normalizeXai("grok-imagine-video-1.5-lite"),
        normalizeXai("grok-imagine-video"),
      ];
    default:
      return [];
  }
}

/** Like seedSetup, for any provider. */
export async function seedProvider(
  page: Page,
  provider: ProviderId,
  model: string,
) {
  await page.addInitScript(
    ([id, key, slug, cache]) => {
      localStorage.setItem("take5:provider", id!);
      localStorage.setItem(`take5:key:${id}`, key!);
      localStorage.setItem(`take5:model:${id}`, slug!);
      localStorage.setItem(`take5:models:${id}`, cache!);
    },
    [
      provider,
      KEYS[provider],
      model,
      JSON.stringify({ at: Date.now(), models: seededModels(provider) }),
    ],
  );
}
