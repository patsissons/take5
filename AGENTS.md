# Agent working rules

## Stack

pnpm + TypeScript + React + Vite + Tailwind v4 + shadcn/ui, deployed as
Cloudflare Workers **static assets only** (`wrangler.jsonc` has no `main`;
there is no server code anywhere). Tested with Vitest (unit: `src/`) and
Playwright (e2e: `e2e/`), linted with ESLint, formatted with Prettier.

- TypeScript runs side-by-side per the official TS 7 guidance: `tsc` (and
  `pnpm typecheck`) is the native TS 7 compiler via the `@typescript/native`
  alias, while the `typescript` package is aliased to
  `@typescript/typescript6` because typescript-eslint requires the TS 6 API.
  Do not "simplify" this to a single `typescript` dependency. Drop the dual
  setup only once typescript-eslint supports TS 7 natively.
- TS 7 removed `baseUrl`; keep `paths` entries relative to the repo root.
- Two TypeScript projects: `tsconfig.app.json` (src, DOM lib) and
  `tsconfig.node.json` (configs, e2e, scripts, plus the two runtime-agnostic
  modules Node scripts import: `src/lib/csp.ts` and
  `src/providers/hosts.ts`, which must stay free of DOM and React).
- Vitest runs with globals off; always import `describe`/`it`/`expect` from
  `vitest` in test files.
- `vitest.setup.ts` registers Testing Library `cleanup()` explicitly; do not
  remove it, or rendered components leak across tests.
- Add shadcn/ui components with `pnpm dlx shadcn@latest add <component>`.

## Workflow

After making changes from a prompt and BEFORE committing:

1. Author new tests covering the changes being made.
2. Update any documentation affected by the changes (README, this file).
3. Run `pnpm format-and-validate` and repair any regressions in-line. This
   includes the Playwright e2e suite; never skip it.

Commit in small, modular units (one logical change per commit).

## Product invariants

- **Zero backend, provable privacy.** The app ships as static files and
  talks to nothing but the video provider the visitor picked, using the
  visitor's own key. No analytics, no cookies, no third-party scripts or
  fonts (Geist is bundled from `@fontsource-variable/geist`). Never add a
  dependency that phones home.
- **The host list is the law.** `src/providers/hosts.ts` lists every host
  each provider adapter may contact. `scripts/headers.ts` (`pnpm headers`,
  also run by `pnpm build`) writes it into the Content-Security-Policy in
  `public/_headers`, which Cloudflare serves with every response;
  `src/lib/csp.test.ts` fails when the committed file is stale. The dev and
  preview servers send the same headers (`vite.config.ts`), so the browser
  enforces the policy in e2e as well (`e2e/csp.spec.ts`). Adding a host
  means editing `hosts.ts`, running `pnpm headers` and committing both.
- **No inline scripts.** The CSP's `script-src` is `'self'`. The theme is
  applied before first paint by `public/theme-init.js` (a blocking external
  script), which mirrors `src/lib/theme.ts` (key `take5:theme`, media query,
  theme-color values): change both together. `e2e/theme.spec.ts` checks the
  script works without the app.
- **Light and dark themes.** The theme is the `dark` class on `<html>`;
  `index.css` defines light tokens on `:root` and dark ones on `.dark`, so
  every colour must come from a token (or a `dark:` variant). The page
  follows the system setting until the visitor uses the toggle, which is
  remembered in `localStorage`.
- Mobile-friendly: page padding comes from the `safe-x` utility in
  `index.css`; `e2e/home.spec.ts` guards against horizontal scroll.
- **Provider adapters are the only provider-specific code.** Each file in
  `src/providers/` implements `MediaProvider` (`types.ts`): the kinds it
  makes (`video`, `image`), key check, a model list per kind (normalised
  to `MediaModel`, pricing included), submit, a `watch` generator that
  hides polling vs streaming behind `JobEvent`s, and the media download.
  The UI, `src/lib/use-run.ts` and history only ever see those neutral
  shapes. Adapters are unit-tested against recorded
  fixtures in `src/providers/fixtures/`; `e2e/fixtures.ts` serves the same
  fixtures to the browser. A provider whose list carries no capabilities
  (fal; its prices are batch-fetched with the list, fifty endpoints per
  pricing call, so the picker can filter by cost) implements `inspectModel`, which the model picker calls on pick and
  whose result (field names in `MediaModel.extra`) is cached and echoed
  back on `MediaRequest.extra` at submit time.
- **A synchronous image API answers at submit.** OpenRouter, Gemini and
  xAI return the image in the response, so those adapters list `image` in
  `answersAtSubmit` and return the ending as `JobRef.answer` (memory
  only). `use-run.ts` settles it straight away and never stores the job,
  so there is nothing to resume and a reload never sends the request
  again. Inline bytes are decoded with `base64ToBlob` (the CSP's
  `connect-src` blocks `data:` URLs) and `redactBase64` keeps them out of
  the raw events table. fal images use the queue like video and resume.
- **Image bytes never add a host.** Ask for inline base64 (xAI's
  `response_format: "b64_json"`) or use a CDN already listed; fal's
  `watch` fails a result outside `*.fal.media` with a clear message rather
  than letting the browser block the download.
- **Model ranking is a bundled snapshot.** `src/lib/model-ranking.ts`
  holds arena Elo scores (fetching them would break the host list), one
  table per kind in `ARENAS` (the video and the text-to-image arenas),
  matched to any provider's model by family regex plus exact tier words
  (fast, lite, pro, max…; images add flash, quality, klein, flex…) so a
  cheaper tier never inherits its flagship's score and a video model never
  takes an image model's. Refresh each by hand from its leaderboard,
  update its `asOf`, and extend `model-ranking.test.ts` with the new slugs.
- **The Privacy page is generated, not written.** `privacy-page.tsx` lists
  `providers[].hosts`, the same list the CSP is built from, so the page can
  never drift from the policy (`e2e/privacy.spec.ts` checks they match).
- **Resume is driven by history.** A run keeps its `JobRef` in IndexedDB
  while in flight; `App` resumes the newest one for the current provider on
  load and clears the ref once the job ends. Only an answer from the
  provider ends a run: a network-level error (`ProviderError` without a
  status) retries in `use-run.ts`, and nothing is recorded while the page
  unloads, so a reload never turns a live job into a failed one. Routing is the URL hash only
  (`src/lib/use-hash.ts`): `#privacy` is the one other page.
- **Storage degrades, never breaks.** `src/lib/settings.ts` (local/session
  storage) and `src/lib/history.ts` (IndexedDB) swallow every storage
  error and return empty results, so the app works in private mode.
- **Each mode keeps its own model.** `take5:mode` is video or image;
  video keeps the original `model:<provider>` / `models:<provider>` keys
  and image uses `image-model:` / `image-models:`, so nothing migrates. A
  run's kind is `request.kind` (missing means video). Images live in the
  `videos` store and `Run.videoBytes`/`videoType` despite the names;
  renaming stored fields needs a migration.
- E2e is hermetic: specs stub every provider host with `page.route` and
  never reach the network. `seedSetup` skips the setup card by writing the
  provider, key, model and cached model list straight into localStorage;
  `seedProvider` does the same for any provider and either mode.
- **Free to operate.** Cloudflare free tier only.

## Gotchas

- `wrangler preview` (the PR preview workflow) fails unless `wrangler.jsonc`
  has a `previews` block; keep the empty `"previews": {}`.
- `tsc -b` build info (`node_modules/.tmp`) can go stale after tsconfig
  edits; delete it if typecheck results look wrong.
- `public/og.png` and `public/apple-touch-icon.png` are generated
  (`pnpm og`, `scripts/og/render.ts`); regenerate them instead of editing the
  PNGs. `scripts/` is typechecked under `tsconfig.node.json` with
  `allowImportingTsExtensions` because Node runs the scripts directly.
- `vitest.setup.ts` replaces Node's method-less `localStorage` with an
  in-memory one (cleared after each test) and stubs `matchMedia` as a light
  system theme; tests that need another answer redefine `window.matchMedia`.
- lucide-react has no brand icons; the GitHub mark is
  `src/components/github-icon.tsx`.
- React StrictMode runs effects twice in dev; an effect that fetches must
  guard with a ref (see `model-picker.tsx`) or e2e sees doubled requests.
- The dev server runs `vite dev`; Playwright's WebKit answers a
  `page.route` that matches a URL before the CSP check runs, so never stub
  a host in a test that expects the CSP to block it.
- Component files export components only (`react-refresh/only-export-components`);
  helpers live in `src/lib/` so tests can import them without rendering.
- Vite warns that `/theme-init.js` "can't be bundled without type=module";
  that is intended (it must run before the module graph loads).
