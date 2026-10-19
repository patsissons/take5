# take5

Five-second AI videos, straight from your browser, served at
<https://take5.lgtm.page>. Pick a provider, paste your own API key, choose a
video model, describe the clip (optionally with a reference image), watch
the job run and get the video back.

There is no server. Every request goes from your browser directly to the
provider you picked; the only storage is in your browser. The app makes this
enforceable, not just promised: a Content-Security-Policy served with every
page lets it contact nothing but the providers' hosts, and the browser blocks
everything else.

## Providers

| Provider           | Models from                   | Video comes back as        |
| ------------------ | ----------------------------- | -------------------------- |
| OpenRouter         | `/api/v1/videos/models`       | authenticated download     |
| fal                | `api.fal.ai/v1/models`        | public media URL           |
| Gemini (Veo)       | `v1beta/models`               | file fetched with your key |
| xAI (Grok Imagine) | `/v1/video-generation-models` | URL                        |

Each adapter in `src/providers/` implements the same interface; the UI never
sees a provider-specific shape.

## How a run works

1. **Setup** (first run): pick a provider, paste its API key (checked with
   one cheap request, then kept in `localStorage`, or `sessionStorage` when
   "Remember on this device" is off), and pick a video model from the
   provider's own list (cached locally, searchable, or a slug typed by
   hand).
2. **Compose**: a prompt, optional reference or first/last-frame images
   (an added image is a reference when the model takes one, otherwise the
   next free frame; downscaled in the browser and sent inline as data
   URLs), and the
   controls the model supports: duration (defaults to the supported value
   nearest 5 s), resolution, aspect ratio or size, audio. The estimated
   cost shows when the model lists a per-second price.
3. **Run**: the job is submitted and watched live, with a timeline
   (submitted, queued, generating, done), an elapsed clock and the raw
   provider events. A reload resumes watching.
4. **Result**: the clip plays from a blob kept in IndexedDB (so it outlives
   the provider's URL), with download, copy prompt and remix.
5. **History**: every run (prompt, settings, thumbnail, cost, video) is
   listed below the composer with a storage meter, per-run delete and clear
   all. "Delete everything" (footer, and the Privacy page at `#privacy`)
   wipes keys, settings and the database.

## Privacy, enforced

- `src/providers/hosts.ts` lists every host the app may contact.
- `pnpm headers` writes that list into the CSP in `public/_headers`, which
  Cloudflare serves with every response. The dev server sends the same
  headers, and `e2e/csp.spec.ts` proves a request to any other host is
  blocked by the browser.
- No analytics, cookies, third-party scripts or fonts. `Referrer-Policy:
no-referrer` means not even the provider learns which page sent the request.
- Keys, settings and videos live in `localStorage` / IndexedDB on your
  device, and "Delete everything" clears them.

## Stack

- React 19, Vite, Tailwind v4, shadcn/ui
- Cloudflare Workers static assets (no Worker script)
- Vitest (unit), Playwright (e2e on desktop Chrome and mobile Safari),
  ESLint, Prettier

## Setup

```sh
pnpm install
pnpm exec playwright install webkit chromium
pnpm dev
```

## Scripts

| Script                     | What it does                                                  |
| -------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                 | Vite dev server (with the production security headers)        |
| `pnpm build`               | Regenerate `public/_headers`, then a production build         |
| `pnpm preview`             | Serve the production build locally                            |
| `pnpm deploy`              | Build and `wrangler deploy`                                   |
| `pnpm headers`             | Regenerate `public/_headers` from `src/providers/hosts.ts`    |
| `pnpm og`                  | Regenerate `public/og.png` and `public/apple-touch-icon.png`  |
| `pnpm typecheck`           | `tsc -b` over the app and tooling                             |
| `pnpm test`                | Unit tests (Vitest)                                           |
| `pnpm test:watch`          | Unit tests in watch mode                                      |
| `pnpm test:e2e`            | Playwright e2e tests (starts its own dev server on port 5198) |
| `pnpm lint`                | ESLint                                                        |
| `pnpm format`              | Prettier (write)                                              |
| `pnpm format:check`        | Prettier (check)                                              |
| `pnpm validate:quick`      | Format check, typecheck, lint and unit tests                  |
| `pnpm validate`            | `validate:quick`, then the e2e suite (used by CI)             |
| `pnpm format-and-validate` | `format`, then `validate` (run before every commit)           |

## Deploy

```sh
pnpm run deploy
```

Requires `wrangler login` (or `CLOUDFLARE_API_TOKEN`, e.g. in a gitignored
`.env`). Production is served at <https://take5.lgtm.page> (a custom domain
in `wrangler.jsonc` `routes`), with a `workers.dev` fallback.

CI (`.github/workflows/ci.yml`) validates every PR and deploys `main`; it
needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository
secrets. Every PR also gets a preview (`.github/workflows/preview.yml`) at
`https://pr-<N>-take5.<subdomain>.workers.dev`, posted as a PR comment and
deleted when the PR is closed.
