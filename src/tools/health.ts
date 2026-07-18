import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { messageOf } from '@chrischall/mcp-utils';
import type { ParkDirectory } from '../parks.js';
import { jsonResponse } from './_shared.js';

export function registerHealthTools(server: McpServer, directory: ParkDirectory): void {
  server.registerTool(
    'sixflags_healthcheck',
    {
      description:
        'Check that the upstream data source (themeparks.wiki) is reachable and returning Six Flags park data. Returns ok/degraded plus the number of parks discovered.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const parks = await directory.list();
        return jsonResponse({
          status: parks.length > 0 ? 'ok' : 'degraded',
          upstream: 'themeparks.wiki',
          parksDiscovered: parks.length,
        });
      } catch (err) {
        return jsonResponse({
          status: 'error',
          upstream: 'themeparks.wiki',
          error: messageOf(err),
        });
      }
    },
  );
}
