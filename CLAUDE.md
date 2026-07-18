# sixflags-mcp

MCP server for **Six Flags** theme parks — live wait times, park hours, show schedules, attraction directory, and day-planning. Backed by the public, keyless [themeparks.wiki](https://themeparks.wiki) v1 API. stdio transport. Built on `@chrischall/mcp-utils` (the fleet's rate-limited-public-API / no-auth-reads archetype — see `mcp-utils/skills/mcp-fleet-builder/SKILL.md`).

## Commands

```bash
npm run build          # tsc → dist/, then esbuild bundle → dist/bundle.js
npm test               # vitest run
npm run test:coverage  # vitest with the 100% coverage gate (CI)
npm run test:watch     # vitest in watch mode
npm run dev            # node --env-file=.env dist/index.js (requires a build)
```

`dist/` is gitignored — produced at build/release time and shipped in the npm package (`package.json` `files`).

## Architecture

```
src/
  index.ts          MCP entry — runMcp() from @chrischall/mcp-utils; builds a ParkDirectory (the dep) and applies the tool registrars. No auth step (keyless upstream).
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

Each `tools/*.ts` exports `registerXTools(server: McpServer, directory: ParkDirectory)` and calls `server.registerTool(name, { description, inputSchema, annotations }, handler)`. `index.ts` threads the single `ParkDirectory` instance as `deps` to every registrar.

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

`ParkDirectory.resolve(ref?)` priority: exact park id → exact name/slug → unique name/destination substring → error (ambiguous lists the matches; unknown points at `sixflags_list_parks`). `undefined` resolves the home park (`getHomePark()`), itself run through the same matcher. The directory memoizes `/v1/destinations` for 12h (injectable clock for tests).

## Environment

```
SIXFLAGS_HOME_PARK            Optional. Default park for tools that don't name one — a name, slug, or park id. Default "Carowinds".
SIXFLAGS_REQUEST_TIMEOUT_MS   Optional. Per-request timeout in ms. Default 15000.
SIXFLAGS_USER_AGENT           Optional. User-Agent sent to themeparks.wiki.
```

`.env` (project root) is loaded by `client.ts` via `loadDotenvSafely` (silently skipped in the mcpb bundle). There are no secrets — the upstream is keyless.

## Testing

`vitest.config.ts` enforces 100% line/branch/function/statement coverage on `src/**` (excluding `src/index.ts`, the stdio entry). No real network — `SixFlagsClient.request` is mocked via `vi.spyOn` (`tests/_fixtures.ts` provides a `makeDirectory` helper that routes stubbed responses by path). `tests/server-boot.test.ts` spawns the real `dist/index.js` and the no-`node_modules` `dist/bundle.js` and drives the `initialize` + `tools/list` handshake (catches eager-import crashes / a wrong `bin` path). `tests/version-sync.test.ts` guards the release-please version markers.

## Distribution & releases

Packaging: `manifest.json` (mcpb), `server.json` (MCP registry — description **≤ 100 chars**), `.claude-plugin/{plugin,marketplace}.json`, `.mcp.json`, `skills/sixflags/SKILL.md`, `.mcpbignore`.

Versioning is **release-please** — do NOT hand-bump. The version lives in `package.json`, `src/index.ts` (`// x-release-please-version` marker), `manifest.json`, `server.json`, and `.claude-plugin/*`; every one is registered in `release-please-config.json` `extra-files` and `versionSyncTest` guards them. `.release-please-manifest.json` is seeded at `0.0.0`, so the first `feat:` PR ships `v0.1.0`. Conventional-commit PR titles drive the bump (`feat:` minor, `fix:` patch). The release-please workflow's `mcp-publish` step derives the package + skill name from the repo (single `skills/*/SKILL.md` → auto-discovered; no `skill-path` pin needed).

## PRs & merging

Branch + PR; `pr-auto-review` + `auto-merge` ship it on a `pass`/`warn` verdict + green CI. Don't add `ready-to-merge` or merge manually. Squash-only. See the fleet conventions in `mcp-utils/CLAUDE.md`.

## Gotchas

- **ESM + NodeNext**: relative imports need `.js` extensions even from `.ts` (`import { client } from './client.js'`).
- **stdio transport**: stdout is JSON-RPC only — all logging goes to stderr.
- **No ride-type metadata**: the API doesn't classify coasters vs flat rides. `sixflags_suggest_next` ranks purely by wait; any thrill/family preference is the caller's (the model's) to apply from ride names.
- **Waits are hours-gated**: off-hours everything reads CLOSED with no wait. Tools surface `parkOpen` so callers don't misread a closed park as "no lines".
- **Park id vs destination id**: live/schedule/children take the PARK id. `ParkDirectory` only ever exposes park ids, so tools can't confuse them.
- **No hosted connector (yet)**: this is stdio-only. A Cloudflare Worker connector would be trivial here (keyless → no OAuth), but isn't built. See the fleet-builder skill's "Hosted connector" section if adding one.
