import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { SixFlagsClient } from '../src/client.js';
import { ParkDirectory } from '../src/parks.js';
import { registerParkTools } from '../src/tools/parks.js';
import { registerWaitTimeTools } from '../src/tools/waittimes.js';
import { registerAttractionTools } from '../src/tools/attractions.js';
import { registerHealthTools } from '../src/tools/health.js';

// Handshake + tool-surface test for the Six Flags Cloudflare remote connector,
// run inside the real Workers runtime (Miniflare) via
// `@cloudflare/vitest-pool-workers` against `wrangler.jsonc`. It proves three
// things that need no live themeparks.wiki call:
//   1. the OAuth default handler serves discovery + the login page;
//   2. an unauthenticated `/mcp` request is rejected before any tool code runs;
//   3. the exact registrar wiring `src/worker.ts` uses registers the FULL stdio
//      tool surface — every Six Flags tool is a keyless public read, so unlike
//      the setlist.fm connector nothing is carved out of the hosted build.
//
// The full authenticated `initialize` + `tools/list` handshake over `/mcp`
// requires a real OAuth access token minted via `workers-oauth-provider`'s
// KV-backed grant flow, out of scope for a hermetic in-process test. So #3
// asserts tool registration through the same in-memory MCP harness the stdio
// suite uses, wired exactly as `worker.ts` wires it, rather than through the
// token-gated `/mcp` route.

// The complete hosted surface — identical to the stdio server's, in the order
// src/index.ts applies the registrars.
const EXPECTED_TOOLS = [
  'sixflags_list_parks',
  'sixflags_get_park_schedule',
  'sixflags_get_wait_times',
  'sixflags_suggest_next',
  'sixflags_list_attractions',
  'sixflags_get_shows',
  'sixflags_healthcheck',
];

describe('Six Flags Cloudflare connector — OAuth surface', () => {
  it('serves the OAuth authorization-server discovery document', async () => {
    const res = await SELF.fetch('https://example.com/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    const meta = (await res.json()) as { authorization_endpoint?: string; token_endpoint?: string };
    expect(meta.authorization_endpoint).toContain('/authorize');
    expect(meta.token_endpoint).toContain('/token');
  });

  it('rejects an unauthenticated /mcp request', async () => {
    const res = await SELF.fetch('https://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('GET /authorize renders the Six Flags login page with the home-park field', async () => {
    // No `client_id` query param: the login page renders without needing a
    // registered OAuth client, which is all we verify here.
    // `redirect_uri` IS required though — workers-oauth-provider 0.8.x calls
    // validateRedirectUriScheme() unconditionally in parseAuthRequest(), and it
    // throws "Invalid redirect URI" for any value without a scheme, including
    // the empty string an absent param becomes. Don't drop it.
    const res = await SELF.fetch(
      'https://example.com/authorize?response_type=code&state=abc' +
        '&redirect_uri=' +
        encodeURIComponent('https://example.com/callback'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Six Flags');
    // The single login field is the home park — NOT a credential.
    expect(html).toContain('name="homePark"');
    expect(html).toContain('Home park');
    expect(html).toContain('type="text"');
    // Nothing secret is collected, so there must be no password input at all.
    expect(html).not.toContain('type="password"');
    // The privacy note must state honestly that no credentials are stored.
    expect(html).toContain('No credentials are collected or stored');
  });
});

describe('Six Flags Cloudflare connector — tool surface', () => {
  it('registers the full stdio tool surface via the same wiring as worker.ts', async () => {
    // Mirror src/worker.ts's buildClient + `tools` array exactly (same order,
    // same wiring): a per-user ParkDirectory carrying a fresh client.
    const directory = new ParkDirectory(new SixFlagsClient(), { homePark: 'Cedar Point' });

    const harness = await createTestHarness((server) => {
      registerParkTools(server, directory);
      registerWaitTimeTools(server, directory);
      registerAttractionTools(server, directory);
      registerHealthTools(server, directory);
    });

    try {
      const names = (await harness.listTools()).map((t) => t.name).sort();
      expect(names).toEqual([...EXPECTED_TOOLS].sort());
    } finally {
      await harness.close();
    }
  });
});
