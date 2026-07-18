import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerParkTools } from '../../src/tools/parks.js';
import { registerAttractionTools } from '../../src/tools/attractions.js';
import { makeDirectory, type StubOverrides } from '../_fixtures.js';

afterEach(() => vi.useRealTimers());

const attractionHarness = (overrides: StubOverrides) => {
  const { directory } = makeDirectory(overrides);
  return createTestHarness((s) => registerAttractionTools(s, directory));
};
const parkHarness = (overrides: StubOverrides) => {
  const { directory } = makeDirectory(overrides);
  return createTestHarness((s) => registerParkTools(s, directory));
};

// These exercise the loose-schema drift guards — the `?? null` / `?? ''` /
// `?? []` fallbacks that let a themeparks.wiki shape change degrade gracefully
// rather than crash.
describe('sparse / drifted payloads degrade gracefully', () => {
  it('get_shows: entryless types, bare showtimes, and missing status', async () => {
    const h = await attractionHarness({
      live: {
        id: 'p',
        name: 'P',
        liveData: [
          { name: 'noType' }, // no entityType → filtered out
          { entityType: 'SHOW', name: 'Bare', showtimes: [{}] }, // bare showtime, no status
        ],
      },
    });
    const data = parseToolResult<{
      shows: { name: string; status: string; showtimes: { type: null; startTime: null; endTime: null }[] }[];
    }>(await h.callTool('sixflags_get_shows', {}));
    expect(data.shows.map((s) => s.name)).toEqual(['Bare']);
    expect(data.shows[0]!.status).toBe('UNKNOWN');
    expect(data.shows[0]!.showtimes[0]).toEqual({ type: null, startTime: null, endTime: null });
    await h.close();
  });

  it('get_shows: whole liveData array absent', async () => {
    const h = await attractionHarness({ live: { id: 'p', name: 'P' } });
    const data = parseToolResult<{ showCount: number }>(await h.callTool('sixflags_get_shows', {}));
    expect(data.showCount).toBe(0);
    await h.close();
  });

  it('list_attractions: missing entityType and a location with only latitude', async () => {
    const h = await attractionHarness({
      children: {
        id: 'p',
        name: 'P',
        children: [
          { id: 'x1', name: 'NoType' }, // no entityType → filtered out
          { id: 'x2', name: 'LatOnly', entityType: 'ATTRACTION', location: { latitude: 12 } },
        ],
      },
    });
    const data = parseToolResult<{ count: number; attractions: { location: unknown }[] }>(
      await h.callTool('sixflags_list_attractions', {}),
    );
    expect(data.count).toBe(1);
    expect(data.attractions[0]!.location).toEqual({ latitude: 12, longitude: null });
    await h.close();
  });

  it('list_attractions: whole children array absent', async () => {
    const h = await attractionHarness({ children: { id: 'p', name: 'P' } });
    const data = parseToolResult<{ count: number }>(await h.callTool('sixflags_list_attractions', {}));
    expect(data.count).toBe(0);
    await h.close();
  });

  it('get_park_schedule: no timezone and a typeless today entry → UTC fallback + closed note', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z'));
    const h = await parkHarness({
      schedule: { id: 'p', name: 'P', schedule: [{ date: '2026-07-18', openingTime: 'x', closingTime: 'y' }] },
    });
    const data = parseToolResult<{ timezone: string | null; today: { note?: string }; schedule: { type: null }[] }>(
      await h.callTool('sixflags_get_park_schedule', {}),
    );
    expect(data.timezone).toBeNull();
    expect(data.today.note).toBeTruthy(); // typeless entry is not OPERATING → note branch
    expect(data.schedule[0]!.type).toBeNull();
    await h.close();
  });

  it('get_park_schedule: whole schedule array absent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z'));
    const h = await parkHarness({ schedule: { id: 'p', name: 'P', timezone: 'UTC' } });
    const data = parseToolResult<{ schedule: unknown[] }>(await h.callTool('sixflags_get_park_schedule', {}));
    expect(data.schedule).toEqual([]);
    await h.close();
  });
});
