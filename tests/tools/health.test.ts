import { describe, expect, it, vi } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerHealthTools } from '../../src/tools/health.js';
import { SixFlagsClient } from '../../src/client.js';
import { ParkDirectory } from '../../src/parks.js';
import { makeDirectory } from '../_fixtures.js';

describe('sixflags_healthcheck', () => {
  it('reports ok with a park count when the upstream is healthy', async () => {
    const { directory } = makeDirectory();
    const h = await createTestHarness((s) => registerHealthTools(s, directory));
    const data = parseToolResult<{ status: string; parksDiscovered: number }>(
      await h.callTool('sixflags_healthcheck', {}),
    );
    expect(data.status).toBe('ok');
    expect(data.parksDiscovered).toBe(5);
    await h.close();
  });

  it('reports degraded when no parks are discovered', async () => {
    const { directory } = makeDirectory({ destinations: { destinations: [] } });
    const h = await createTestHarness((s) => registerHealthTools(s, directory));
    const data = parseToolResult<{ status: string; parksDiscovered: number }>(
      await h.callTool('sixflags_healthcheck', {}),
    );
    expect(data.status).toBe('degraded');
    expect(data.parksDiscovered).toBe(0);
    await h.close();
  });

  it('reports an error when the upstream throws', async () => {
    const client = new SixFlagsClient();
    vi.spyOn(client, 'request').mockRejectedValue(new Error('boom'));
    const directory = new ParkDirectory(client);
    const h = await createTestHarness((s) => registerHealthTools(s, directory));
    const data = parseToolResult<{ status: string; error: string }>(
      await h.callTool('sixflags_healthcheck', {}),
    );
    expect(data.status).toBe('error');
    expect(data.error).toBe('boom');
    await h.close();
  });
});
