# take5

Five-second AI videos and stills, straight from your browser, served at
<https://take5.lgtm.page>. Pick a provider, paste your own API key, choose a
video or image model, describe the clip or picture (optionally with a
reference image), watch the job run and get the video or image back.

There is no server. Every request goes from your browser directly to the
provider you picked; the only storage is in your browser. The app makes this
enforceable, not just promised: a Content-Security-Policy served with every
page lets it contact nothing but the providers' hosts, and the browser blocks
everything else.

## Providers

| Provider           | Video models from             | Video comes back as        |
| ------------------ | ----------------------------- | -------------------------- |
| OpenRouter         | `/api/v1/videos/models`       | authenticated download     |
| fal                | `api.fal.ai/v1/models`        | public media URL           |
| Gemini (Veo)       | `v1beta/models`               | file fetched with your key |
| xAI (Grok Imagine) | `/v1/video-generation-models` | URL                        |

| Provider                 | Image models from                         | Image comes back as         |
| ------------------------ | ----------------------------------------- | --------------------------- |
| OpenRouter               | `/api/v1/images/models` (+ `/endpoints`)  | base64 in the answer        |
| fal                      | `api.fal.ai/v1/models` (text/image→image) | public media URL, via queue |
| Gemini (Nano Banana)     | `v1beta/models` (`generateContent`)       | base64 in the answer        |
| xAI (Grok Imagine Image) | `/v1/image-generation-models`             | base64 in the answer        |

No image needs a host beyond the ones video already uses.

Each adapter in `src/providers/` implements the same interface; the UI never
sees a provider-specific shape.

## How a run works

1. **Setup** (first run): pick a provider, paste its API key (checked with
   one cheap request, then kept in `localStorage`, or `sessionStorage` when
   "Remember on this device" is off), and pick a video or image model
   (the Video | Image toggle) from the provider's own list (cached locally,
   searchable, or a slug typed by hand). The list is sorted best first by a
   bundled snapshot of the
   [Artificial Analysis Video Arena](https://artificialanalysis.ai/video/leaderboard/text-to-video)
   or [Image Arena](https://artificialanalysis.ai/text-to-image/arena/leaderboard-text)
   Elo, shown on each ranked model; unranked models follow. A two-thumb
   slider narrows the list by the cost of the cheapest 5 s clip or image
   (models without a listed price drop out once it is narrowed). Later,
   "Change model" and "Change provider" reopen these steps from the
   studio, the toggle switches between the two kinds (each remembers its
   own model), and Cancel (or Esc) goes back without changes.
2. **Compose**: a prompt, optional reference or first/last-frame images
   (an added image is a reference when the model takes one, otherwise the
   next free frame; downscaled in the browser and sent inline as data
   URLs), and the
   controls the model supports: duration (defaults to the supported value
   nearest 5 s), resolution, aspect ratio or size, audio. A still has no
   duration or audio, takes as many references as its model allows, and
   an edit-only model waits for one. The estimated cost shows when the
   model lists a per-second, per-image or per-megapixel price.
3. **Run**: the job is submitted and watched live, with a timeline
   (submitted, queued, generating, done), an elapsed clock and a table of the raw
   provider events. A reload resumes watching. Images from OpenRouter,
   Gemini and xAI come back in the answer to the request itself, so there
   is nothing to watch or resume (a reload mid-request loses that one);
   fal images queue and resume like videos.
4. **Result**: the clip plays (or the image shows) from a blob kept in
   IndexedDB (so it outlives the provider's URL), with download, copy
   prompt and remix, and the cost next to how long the generation took.
5. **History**: every run (prompt, settings, thumbnail, cost, generation time,
   video or image) is
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
- Keys, settings, videos and images live in `localStorage` / IndexedDB on your
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

CI (`.github/workflows/ci.yml`) validates every PR and deploys `main`.
Every PR also gets a preview (`.github/workflows/preview.yml`) at
`https://pr-<N>-take5.<subdomain>.workers.dev`, posted as a PR comment and
deleted when the PR is closed. Both read `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` from GitHub environment secrets, not repository
ones: the deploy from the `production` environment, previews from the
`preview` environment.
