#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { client } from './client.js';
import { ParkDirectory } from './parks.js';
import { VERSION } from './version.js';
import { registerParkTools } from './tools/parks.js';
import { registerWaitTimeTools } from './tools/waittimes.js';
import { registerAttractionTools } from './tools/attractions.js';
import { registerHealthTools } from './tools/health.js';

// The park directory memoizes the (large, slow-changing) themeparks.wiki
// destinations list and resolves a caller's park reference — including the
// configured home park — to a park entity id. One instance is threaded to every
// tool registrar as its dependency; it carries the API client on `.client`.
const directory = new ParkDirectory(client);

// runMcp builds the McpServer, applies the registrars (with `directory` threaded
// through as deps), prints the banner to stderr, wires SIGINT/SIGTERM graceful
// shutdown, and connects the stdio transport. There is no credential step — the
// upstream (themeparks.wiki) is a public, keyless API — so the server is ready
// the moment the transport connects.
await runMcp({
  name: 'sixflags',
  version: VERSION,
  deps: directory,
  tools: [registerParkTools, registerWaitTimeTools, registerAttractionTools, registerHealthTools],
  banner:
    '[sixflags-mcp] Live Six Flags wait times, park hours, and day-planning via themeparks.wiki. Developed and maintained by AI (Claude). Use at your own discretion.',
});
