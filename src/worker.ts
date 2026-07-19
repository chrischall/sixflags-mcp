import { createConnector } from '@chrischall/mcp-connector';
import { SixFlagsClient } from './client.js';
import { ParkDirectory } from './parks.js';
import { sixflagsAuth, type SixFlagsProps } from './sixflags-auth.js';
import { VERSION } from './version.js';
import { registerParkTools } from './tools/parks.js';
import { registerWaitTimeTools } from './tools/waittimes.js';
import { registerAttractionTools } from './tools/attractions.js';
import { registerHealthTools } from './tools/health.js';

// The Cloudflare remote-connector entrypoint: wires the Six Flags tool
// registrars into `@chrischall/mcp-connector`'s generic OAuth + McpAgent
// harness.
//
// Unlike the setlist.fm connector — which builds a per-user client from the
// user's own API key — themeparks.wiki is PUBLIC AND KEYLESS, so there is no
// credential to thread through. What `buildClient` personalizes instead is the
// user's HOME PARK: the default every tool falls back to when a call doesn't
// name one (collected and verified by `src/sixflags-auth.ts`).
//
// Note the dependency the registrars take is the ParkDirectory, not the raw
// SixFlagsClient — the directory carries the client on `.client` and adds park
// resolution on top. So `buildClient` returns a ParkDirectory wrapping a fresh
// client, one per session.
//
// The service is STATELESS — no cache, no Durable Object storage beyond the
// connector's own per-session `MCP_OBJECT` agent (the directory's 12h
// destinations memo lives in that session's memory) — so there is none of the
// cache plumbing the OFW connector needs.
//
// FULL SURFACE: every Six Flags tool is a read-only, keyless public call, so —
// unlike setlist-mcp, which omits its cookie-session attendance writes — nothing
// is carved out here. The registrars below are in the exact order the stdio
// server (`src/index.ts`) applies them.
const { Agent, handler } = createConnector<SixFlagsProps, ParkDirectory>({
  name: 'sixflags-mcp',
  version: VERSION,
  buildClient: (props) => new ParkDirectory(new SixFlagsClient(), { homePark: props.homePark }),
  auth: sixflagsAuth,
  tools: [registerParkTools, registerWaitTimeTools, registerAttractionTools, registerHealthTools],
});

// The connector's per-session MCP agent Durable Object
// (`wrangler.jsonc`'s `MCP_OBJECT` → `SixFlagsMcpAgent`) resolves this named export.
export { Agent as SixFlagsMcpAgent };

export default handler;
