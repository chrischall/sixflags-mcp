# sixflags-mcp

MCP server for **Six Flags** theme parks — live wait times, park hours, show schedules, attraction directory, and day-planning. Backed by the public, keyless [themeparks.wiki](https://themeparks.wiki) v1 API. Two entry points: stdio (`src/index.ts`, the npm/mcpb package) and a hosted Cloudflare Worker connector (`src/worker.ts` — see [Hosted connector](#hosted-connector-cloudflare-worker)). Built on `@chrischall/mcp-utils` (the fleet's rate-limited-public-API / no-auth-reads archetype — see `mcp-utils/skills/mcp-fleet-builder/SKILL.md`).

## Commands

```bash
npm run build          # tsc → dist/, then esbuild bundle → dist/bundle.js
npm test               # vitest run
npm run test:coverage  # vitest with the 100% coverage gate (CI)
npm run test:watch     # vitest in watch mode
npm run dev            # node --env-file=.env dist/index.js (requires a build)

npm run worker:test    # vitest run --config vitest.workers.config.ts (Workers pool; NOT in CI)
npm run worker:dev     # wrangler dev — the connector locally
npm run worker:deploy  # wrangler deploy — see docs/DEPLOY-CONNECTOR.md
```

`dist/` is gitignored — produced at build/release time and shipped in the npm package (`package.json` `files`).

## Architecture

```
src/
  index.ts          stdio entry — runMcp() from @chrischall/mcp-utils; builds a ParkDirectory (the dep) and applies the tool registrars. No auth step (keyless upstream).
  worker.ts         Cloudflare Worker entry — createConnector() from @chrischall/mcp-connector, same registrars in the same order. Excluded from tsc + the node vitest pool.
  sixflags-auth.ts  ConnectorAuth for the Worker: the one login field (home park) + login() that verifies it. Node-loadable (its only connector import is `import type`), so it IS under the 100% gate.
  version.ts        VERSION — the single release-please version marker. Imported by BOTH entries; worker.ts must never import index.ts.
  protocol.ts       Wire constants: BASE_URL (api.themeparks.wiki), getDefaultHeaders (Accept + User-Agent), getRequestTimeoutMs. Leaf module.
  client.ts         SixFlagsClient — a thin wrapper over createApiClient with NO token resolver (public API → no Authorization header). Exposes request<T>(method, path). Loads .env for local dev.
  config.ts         getHomePark() → SIXFLAGS_HOME_PARK or "Carowinds".
  parks.ts          ParkDirectory — fetches /v1/destinations, filters to the Six Flags chain by slug, flattens to individual parks, memoizes (12h TTL), and resolves a name/slug/substring/id (or the home park) to a park entity id. Carries the client on `.client`.
  tools/
    _shared.ts      jsonResponse + the /live zod schema (fetchLive), attraction normalization (normalizeAttractions), anyRideOperating, byWaitDescending.
    parks.ts        sixflags_list_parks, sixflags_get_park_schedule
    waittimes.ts    sixflags_get_wait_times, sixflags_suggest_next
    attractions.ts  sixflags_list_attractions, sixflags_get_shows
    health.ts       sixflags_healthcheck
tests/              mirrors src/; mocks SixFlagsClient.request via vi.spyOn (see tests/_fixtures.ts). server-boot.test.ts drives the real built artifacts.
```

Each `tools/*.ts` exports `registerXTools(server: McpServer, directory: ParkDirectory)` and calls `server.registerTool(name, { description, inputSchema, annotations }, handler)`. `index.ts` threads the single `ParkDirectory` instance as `deps` to every registrar; `worker.ts` builds one per session in `buildClient`. Both entry points therefore expose the identical seven tools — there is no hosted carve-out, since every tool is a read-only keyless public call.

## Data source: themeparks.wiki v1

Public, keyless, free. No login, no rate-limit headaches at our volume (`createApiClient`'s default 429-retry covers a throttle). A descriptive `User-Agent` is sent as courtesy (override `SIXFLAGS_USER_AGENT`). Endpoints used (all GET):

- `/v1/destinations` — every destination + its parks. **Six Flags filter:** keep destinations whose `slug` starts with `sixflags` (post-merger, the whole Cedar Fair chain carries `sixflags_destination_*` slugs). Flatten each destination's `parks[]` — a destination like "Six Flags St. Louis" contains both the dry park and its Hurricane Harbor.
- `/v1/entity/{parkId}/live` — live wait times + show times + status. `liveData[]` entries have `entityType` (ATTRACTION / SHOW / RESTAURANT), `status` (OPERATING / CLOSED / DOWN / REFURBISHMENT), `queue.STANDBY.waitTime` + `queue.SINGLE_RIDER.waitTime` (minutes; **absent/empty when closed**), and `showtimes[]` for shows.
- `/v1/entity/{parkId}/schedule` — operating hours. `schedule[]` entries have `date` (YYYY-MM-DD), `type` (OPERATING / INFO / …), `openingTime` / `closingTime` (ISO with the park's tz offset).
- `/v1/entity/{parkId}/children` — the attraction/show/restaurant directory. Children have `entityType` and a `location` (lat/lng). **No ride-type field** — there's nothing marking a coaster vs a flat ride; names are the only signal.

**The URL id is the PARK entity id** (the id inside a destination's `parks[]`), NOT the destination id — mixing them 404s. Carowinds' park id is `24cdcaa8-0500-4340-9725-992865eb18d6`.

## Response validation

Every JSON response is validated at the call site with `parseLenient(schema, raw, { label: 'sixflags-mcp', context })` from `@chrischall/mcp-utils`. Schemas are `z.looseObject(...)` covering only the fields we read (unknown keys pass through). Lenient mode: on a shape mismatch it warns to stderr and returns the raw response, which then flows through the `?? fallback` chains — an upstream change degrades gracefully rather than crashing. When adding an endpoint, define a loose schema next to the call and wrap the request.

## Park resolution

`ParkDirectory.resolve(ref?)` priority: exact park id → exact name/slug → unique name/destination substring → error (ambiguous lists the matches; unknown points at `sixflags_list_parks`). `undefined` resolves `directory.configuredHomePark`, itself run through the same matcher. The directory memoizes `/v1/destinations` for 12h (injectable clock for tests).

`configuredHomePark` is the multi-tenancy seam: `new ParkDirectory(client, { homePark })` overrides the default per instance, and it falls back to the process-global `getHomePark()` (`SIXFLAGS_HOME_PARK` → `Carowinds`) when the option is absent or blank. The stdio entry passes nothing, so it stays purely env-driven; the Worker passes each session's OAuth prop. Tools that report the default (`sixflags_list_parks`'s `configuredAs`) must read `directory.configuredHomePark`, **never `getHomePark()` directly** — the latter would leak the operator's default to every hosted user.

## Hosted connector (Cloudflare Worker)

`src/worker.ts` runs the same seven tools as a remote MCP connector on
`@chrischall/mcp-connector`'s OAuth + `McpAgent` harness. **Stateless and
read-only**: the only Durable Object is the harness's per-session agent
(`MCP_OBJECT` → `SixFlagsMcpAgent`); no cache DO, no persisted data beyond the
OAuth props. Operator runbook: `docs/DEPLOY-CONNECTOR.md`.

Files: `src/worker.ts` (entry), `src/sixflags-auth.ts` (the `ConnectorAuth`),
`wrangler.jsonc` (bindings — `nodejs_compat`, the DO + its `v1` SQLite
migration, `OAUTH_KV` with a placeholder id filled in at deploy time, the
`connector.sixflags.nullnet.app` route), `vitest.workers.config.ts` +
`tests/worker.test.ts`. Connector deps are all **devDependencies** — the Worker
is bundled by wrangler and is not part of the published npm package.

### Why the login page asks for a home park

themeparks.wiki is keyless, so there is no credential to collect — but the
harness cannot have zero login fields: `mcp-connector`'s `login.ts` uses
`fields[auth.fields[0].name]` as the OAuth `userId` and would crash without one.
Rather than invent a fake field, the single field is the user's **home park**,
which is genuinely worth remembering per user. So:

- `login()` **verifies** the entry via a live `ParkDirectory.resolve()` and
  stores the resolved *canonical park name*, so an unknown or ambiguous entry
  fails on the login page (where `resolve`'s error message lists the matches)
  instead of on every later tool call. Blank falls back to `getHomePark()` —
  the page's `required` attribute is client-side only and a raw POST can submit
  `''`.
- Props are `{ homePark: string }` and **nothing else**. `privacyNote` must keep
  saying so honestly: no credentials are collected or stored.
- Consequence: the OAuth `userId` *is* the home-park string, so two users with
  the same home park share a userId. Harmless for a stateless public-data
  connector — but do not add per-user writes or storage without changing the
  identity scheme first.

## Environment

```
SIXFLAGS_HOME_PARK            Optional. Default park for tools that don't name one — a name, slug, or park id. Default "Carowinds".
SIXFLAGS_REQUEST_TIMEOUT_MS   Optional. Per-request timeout in ms. Default 15000.
SIXFLAGS_USER_AGENT           Optional. User-Agent sent to themeparks.wiki.
```

`.env` (project root) is loaded by `client.ts` via `loadDotenvSafely` (silently skipped in the mcpb bundle). There are no secrets — the upstream is keyless.

## Testing

Two configs. `vitest.config.ts` (`npm test` / `npm run test:coverage`, the CI gate) runs the node suite and enforces 100% line/branch/function/statement coverage on `src/**`, excluding only the two entry points (`src/index.ts`, `src/worker.ts`); it also `test.exclude`s `tests/worker.test.ts`, which cannot load under Node. `vitest.workers.config.ts` (`npm run worker:test`) runs exactly that file in the real Workers runtime against `wrangler.jsonc`'s bindings — **not wired into CI**, run it by hand when touching the connector. Note `src/sixflags-auth.ts` is node-loadable and therefore inside the 100% gate: `tests/sixflags-auth.test.ts` must cover every `login()` branch. Do not "fix" a coverage failure there by adding it to `coverage.exclude`. No real network — `SixFlagsClient.request` is mocked via `vi.spyOn` (`tests/_fixtures.ts` provides a `makeDirectory` helper that routes stubbed responses by path). `tests/server-boot.test.ts` spawns the real `dist/index.js` and the no-`node_modules` `dist/bundle.js` and drives the `initialize` + `tools/list` handshake (catches eager-import crashes / a wrong `bin` path). `tests/version-sync.test.ts` guards the release-please version markers.

## Distribution & releases

Packaging: `manifest.json` (mcpb), `server.json` (MCP registry — description **≤ 100 chars**), `.claude-plugin/{plugin,marketplace}.json`, `.mcp.json`, `skills/sixflags/SKILL.md`, `.mcpbignore`.

Versioning is **release-please** — do NOT hand-bump. The version lives in `package.json`, `src/version.ts` (`// x-release-please-version` marker — both entry points import `VERSION` from it), `manifest.json`, `server.json`, and `.claude-plugin/*`; every one is registered in `release-please-config.json` `extra-files` and `versionSyncTest` guards them. `.release-please-manifest.json` is seeded at `0.0.0`, so the first `feat:` PR ships `v0.1.0`. Conventional-commit PR titles drive the bump (`feat:` minor, `fix:` patch). The release-please workflow's `mcp-publish` step derives the package + skill name from the repo (single `skills/*/SKILL.md` → auto-discovered; no `skill-path` pin needed).

## PRs & merging

Branch + PR; `pr-auto-review` + `auto-merge` ship it on a `pass`/`warn` verdict + green CI. Don't add `ready-to-merge` or merge manually. Squash-only.

Fleet policy lives in `~/.claude/CLAUDE.md`; shared technical conventions in
[`chrischall/workflows`](https://github.com/chrischall/workflows) →
`docs/fleet-conventions.md`.

## Gotchas

- **ESM + NodeNext**: relative imports need `.js` extensions even from `.ts` (`import { client } from './client.js'`).
- **stdio transport**: stdout is JSON-RPC only — all logging goes to stderr.
- **No ride-type metadata**: the API doesn't classify coasters vs flat rides. `sixflags_suggest_next` ranks purely by wait; any thrill/family preference is the caller's (the model's) to apply from ride names.
- **Waits are hours-gated**: off-hours everything reads CLOSED with no wait. Tools surface `parkOpen` so callers don't misread a closed park as "no lines".
- **Park id vs destination id**: live/schedule/children take the PARK id. `ParkDirectory` only ever exposes park ids, so tools can't confuse them.
- **Two entry points, one tool surface**: adding or renaming a registrar means touching `src/index.ts` AND `src/worker.ts` — they list the registrars independently, in the same order. Nothing is carved out of the hosted build.
- **`src/worker.ts` is invisible to the stdio build on purpose**: `tsconfig.json` `exclude`s it (so `tsc` never emits `dist/worker.js` into the published package) and `vitest.config.ts` excludes it from both coverage and the node pool. It imports `cloudflare:workers` / `agents` and will crash any node test that imports it. Also: it must never import `src/index.ts`, which has a shebang and a top-level `await runMcp()`.
- **Nothing may fetch at Worker module scope**: `wrangler deploy` runs startup validation (error 10021) and a network call at module init fails it. `sixflagsAuth.login()`'s directory probe is safe only because it runs inside the `/authorize` POST handler. Never hoist a warm-up or prefetch out of a handler.
- **`nodejs_compat` is load-bearing**: `src/client.ts` imports `node:path` / `node:url` and `src/protocol.ts` reads `process.env`. Dropping the flag from `wrangler.jsonc` breaks the deploy, not just a request.
