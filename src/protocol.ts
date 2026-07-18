// Wire-level constants for the themeparks.wiki v1 API — the free, no-auth
// upstream that backs every tool. Kept in a leaf module (imported by client.ts
// and the schema-owning tool modules) so there's a single source of truth for
// the base URL and the courtesy headers.
//
// Why themeparks.wiki: it exposes live queue/standby wait times, show
// schedules, ride operating status, park operating hours, and the full
// attraction directory for the Six Flags chain (Carowinds included, under its
// post-merger `sixflags_destination_CA` slug) — with no API key and no login.

export const BASE_URL = 'https://api.themeparks.wiki';

// themeparks.wiki has no auth, but a descriptive User-Agent is good API
// etiquette and helps the operator diagnose our traffic. Overridable via
// SIXFLAGS_USER_AGENT for anyone who wants to identify their own deployment.
export function getDefaultHeaders(): Record<string, string> {
  const ua = process.env.SIXFLAGS_USER_AGENT?.trim();
  return {
    Accept: 'application/json',
    'User-Agent':
      ua && ua.length > 0
        ? ua
        : 'sixflags-mcp (+https://github.com/chrischall/sixflags-mcp)',
  };
}

// Per-request timeout. The themeparks.wiki p99 is well under this; the point is
// to fail fast instead of burning the MCP host's tool-call budget on a stuck
// upstream. Overridable via SIXFLAGS_REQUEST_TIMEOUT_MS.
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export function getRequestTimeoutMs(): number {
  const raw = process.env.SIXFLAGS_REQUEST_TIMEOUT_MS;
  if (typeof raw !== 'string' || raw.trim().length === 0) return DEFAULT_REQUEST_TIMEOUT_MS;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REQUEST_TIMEOUT_MS;
}
