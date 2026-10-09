import { describe, expect, it } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { registerParkTools } from '../../src/tools/parks.js';
import { registerWaitTimeTools } from '../../src/tools/waittimes.js';
import { registerAttractionTools } from '../../src/tools/attractions.js';
import { registerHealthTools } from '../../src/tools/health.js';
import { makeDirectory } from '../_fixtures.js';

describe('tool annotations', () => {
  it('marks every tool read-only, idempotent, and open-world (a third-party public API)', async () => {
    const { directory } = makeDirectory();
    const h = await createTestHarness((s) => {
      registerParkTools(s, directory);
      registerWaitTimeTools(s, directory);
      registerAttractionTools(s, directory);
      registerHealthTools(s, directory);
    });
    const { tools } = await h.client.listTools();
    expect(tools).toHaveLength(7);
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      });
    }
    await h.close();
  });
});
