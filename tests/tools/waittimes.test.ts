import { describe, expect, it } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerWaitTimeTools } from '../../src/tools/waittimes.js';
import { makeDirectory, closedLiveFixture } from '../_fixtures.js';

async function harnessFor(overrides = {}) {
  const { directory } = makeDirectory(overrides);
  return createTestHarness((s) => registerWaitTimeTools(s, directory));
}

describe('sixflags_get_wait_times', () => {
  it('returns attractions longest-first with a crowd summary', async () => {
    const h = await harnessFor();
    const data = parseToolResult<{
      parkOpen: boolean;
      summary: { openCount: number; closedCount: number; averageWaitMinutes: number; longestWait: { name: string }; shortestWait: { waitMinutes: number } };
      attractions: { name: string; open: boolean }[];
    }>(await h.callTool('sixflags_get_wait_times', {}));

    expect(data.parkOpen).toBe(true);
    expect(data.summary.openCount).toBe(3);
    expect(data.summary.closedCount).toBe(2);
    expect(data.summary.averageWaitMinutes).toBe(45); // (75+30+30)/3
    expect(data.summary.longestWait.name).toBe('Fury 325');
    expect(data.summary.shortestWait.waitMinutes).toBe(30);
    expect(data.attractions[0]!.name).toBe('Fury 325'); // longest wait first
    expect(data.attractions).toHaveLength(5);
    await h.close();
  });

  it('returns only operating rides when openOnly is set', async () => {
    const h = await harnessFor();
    const data = parseToolResult<{ attractions: { open: boolean }[] }>(
      await h.callTool('sixflags_get_wait_times', { openOnly: true }),
    );
    expect(data.attractions).toHaveLength(3);
    expect(data.attractions.every((a) => a.open)).toBe(true);
    await h.close();
  });

  it('reports the park as closed with empty summary stats', async () => {
    const h = await harnessFor({ live: closedLiveFixture });
    const data = parseToolResult<{
      parkOpen: boolean;
      summary: { openCount: number; averageWaitMinutes: number | null; longestWait: null; shortestWait: null };
    }>(await h.callTool('sixflags_get_wait_times', {}));
    expect(data.parkOpen).toBe(false);
    expect(data.summary.openCount).toBe(0);
    expect(data.summary.averageWaitMinutes).toBeNull();
    expect(data.summary.longestWait).toBeNull();
    expect(data.summary.shortestWait).toBeNull();
    await h.close();
  });
});

describe('sixflags_suggest_next', () => {
  it('ranks open rides by shortest standby wait', async () => {
    const h = await harnessFor();
    const data = parseToolResult<{ suggestions: { rank: number; name: string; waitMinutes: number }[]; note: string }>(
      await h.callTool('sixflags_suggest_next', {}),
    );
    expect(data.suggestions.map((s) => s.name)).toEqual(['Afterburn', 'Carolina Cyclone', 'Fury 325']);
    expect(data.suggestions[0]!.rank).toBe(1);
    expect(data.note).toMatch(/shortest standby/i);
    await h.close();
  });

  it('applies exclude, maxWait, and limit', async () => {
    const h = await harnessFor();
    const data = parseToolResult<{ suggestions: { name: string }[] }>(
      await h.callTool('sixflags_suggest_next', { exclude: ['fury'], maxWaitMinutes: 30, limit: 1 }),
    );
    expect(data.suggestions.map((s) => s.name)).toEqual(['Afterburn']);
    await h.close();
  });

  it('returns an explanatory note when nothing is open', async () => {
    const h = await harnessFor({ live: closedLiveFixture });
    const data = parseToolResult<{ suggestions: unknown[]; note: string }>(
      await h.callTool('sixflags_suggest_next', {}),
    );
    expect(data.suggestions).toHaveLength(0);
    expect(data.note).toMatch(/No open rides/i);
    await h.close();
  });
});
