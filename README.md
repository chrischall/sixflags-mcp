# sixflags-mcp

MCP server for **Six Flags** theme parks — live ride wait times, park hours, show schedules, and day planning. Your home park (default **Carowinds**) is the default for every tool, so "what are the wait times?" just works. Covers the whole combined Six Flags / Cedar Fair chain: Cedar Point, Kings Island, Canada's Wonderland, Magic Mountain, the Hurricane Harbor water parks, and more.

Data comes from the public [themeparks.wiki](https://themeparks.wiki) API — **no account, no API key, no login**.

> **Built and maintained by AI.** This codebase is developed and maintained by Claude (Claude Code). Use at your own discretion.

## Tools

| Tool | What it does |
| --- | --- |
| `sixflags_get_wait_times` | Every ride's current standby + single-rider wait and status, sorted longest-first, with a crowd summary. |
| `sixflags_suggest_next` | Ranks currently-open rides by shortest wait — the "what should we ride next?" planner. Supports `exclude`, `maxWaitMinutes`, `limit`. |
| `sixflags_get_park_schedule` | Operating hours from today forward. |
| `sixflags_get_shows` | Today's live show schedule (parades, stunt shows, character meets) with showtimes. |
| `sixflags_list_attractions` | The full directory of a park's rides / shows / restaurants, with map coordinates. |
| `sixflags_list_parks` | Every Six Flags park and its id; `search` to filter. |
| `sixflags_healthcheck` | Confirm the upstream data source is reachable. |

Every data tool takes an optional `park` argument (name, slug, unique substring, or id). Omit it for your home park.

## Install

Via `npx` (published to npm):

```json
{
  "mcpServers": {
    "sixflags": {
      "command": "npx",
      "args": ["-y", "sixflags-mcp"],
      "env": { "SIXFLAGS_HOME_PARK": "Carowinds" }
    }
  }
}
```

Or as a Claude Code plugin from the `chrischall` marketplace, or install the `.mcpb` bundle from a release.

## Configuration

All optional — the upstream is keyless.

| Env var | Default | Purpose |
| --- | --- | --- |
| `SIXFLAGS_HOME_PARK` | `Carowinds` | Default park for tools that don't name one. A park name, themeparks.wiki slug, or park id. |
| `SIXFLAGS_REQUEST_TIMEOUT_MS` | `15000` | Per-request timeout. |
| `SIXFLAGS_USER_AGENT` | `sixflags-mcp (+…)` | User-Agent sent to themeparks.wiki. |

## Development

```bash
npm install
npm run build          # tsc → dist/, then esbuild bundle → dist/bundle.js
npm test               # vitest run
npm run test:coverage  # 100% coverage gate (CI)
npm run dev            # node --env-file=.env dist/index.js (requires a build)
```

## Data source & accuracy

Wait times, show times, and hours are provided by themeparks.wiki, which aggregates the parks' own apps. They populate only during operating hours — off-hours every ride reads `CLOSED`. Treat waits as best-effort estimates, not guarantees.
