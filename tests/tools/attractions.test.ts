import { describe, expect, it } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerAttractionTools } from '../../src/tools/attractions.js';
import { makeDirectory } from '../_fixtures.js';

async function harness() {
  const { directory } = makeDirectory();
  return createTestHarness((s) => registerAttractionTools(s, directory));
}

describe('sixflags_list_attractions', () => {
  it('lists attractions with normalized locations, sorted by name', async () => {
    const h = await harness();
    const data = parseToolResult<{
      type: string;
      count: number;
      attractions: { name: string; location: { latitude: number | null; longitude: number | null } | null }[];
    }>(await h.callTool('sixflags_list_attractions', {}));

    expect(data.type).toBe('ATTRACTION');
    expect(data.count).toBe(4);
    const byName = Object.fromEntries(data.attractions.map((a) => [a.name, a.location]));
    expect(byName['Fury 325']).toEqual({ latitude: 35.1, longitude: -80.9 });
    expect(byName['Carolina Cyclone']).toEqual({ latitude: null, longitude: -80.94 });
    expect(byName['No Loc Ride']).toBeNull();
    expect(byName['Empty Loc Ride']).toBeNull();
    expect(data.attractions.map((a) => a.name)).toEqual(['Carolina Cyclone', 'Empty Loc Ride', 'Fury 325', 'No Loc Ride']);
    await h.close();
  });

  it('lists a different entity type when asked', async () => {
    const h = await harness();
    const data = parseToolResult<{ type: string; attractions: { name: string }[] }>(
      await h.callTool('sixflags_list_attractions', { type: 'SHOW' }),
    );
    expect(data.type).toBe('SHOW');
    expect(data.attractions.map((a) => a.name)).toEqual(['A Show']);
    await h.close();
  });
});

describe('sixflags_get_shows', () => {
  it('returns shows with their showtimes', async () => {
    const h = await harness();
    const data = parseToolResult<{
      showCount: number;
      showsWithScheduledTimes: number;
      shows: { name: string; status: string; showtimes: { startTime: string | null }[] }[];
    }>(await h.callTool('sixflags_get_shows', {}));

    expect(data.showCount).toBe(3);
    expect(data.showsWithScheduledTimes).toBe(1);
    expect(data.shows.map((s) => s.name)).toEqual(['Character Meet', 'Silent Show', 'Statusless Show']);
    expect(data.shows.find((s) => s.name === 'Character Meet')!.showtimes[0]!.startTime).toBe('2026-07-18T13:00:00-04:00');
    expect(data.shows.find((s) => s.name === 'Statusless Show')!.status).toBe('UNKNOWN');
    await h.close();
  });
});
