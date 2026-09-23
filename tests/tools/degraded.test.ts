import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerParkTools } from '../../src/tools/parks.js';
import { registerAttractionTools } from '../../src/tools/attractions.js';
import { registerWaitTimeTools } from '../../src/tools/waittimes.js';
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

// One malformed upstream record used to fail the whole-response parse, so
// parseLenient handed back the raw payload and handlers crashed on a bare
// TypeError (e.g. `undefined.localeCompare`). Records are now validated one at
// a time: a bad record is dropped, its neighbours survive, and a bad optional
// field is nulled rather than sinking the record.
describe('a single drifted record is dropped, not fatal', () => {
  const waitHarness = (overrides: StubOverrides) => {
    const { directory } = makeDirectory(overrides);
    return createTestHarness((s) => registerWaitTimeTools(s, directory));
  };

  it('get_wait_times: a nameless ride is dropped and a non-string status is tolerated', async () => {
    const h = await waitHarness({
      live: {
        id: 'p',
        name: 'P',
        liveData: [
          { entityType: 'ATTRACTION', status: 'OPERATING', queue: { STANDBY: { waitTime: 5 } } }, // no name
          { entityType: 'ATTRACTION', name: 'Weird Status', status: 42, queue: { STANDBY: { waitTime: 'x' } } },
          { entityType: 'ATTRACTION', name: 'Good', status: 'OPERATING', queue: { STANDBY: { waitTime: 10 } } },
          null,
        ],
      },
    });
    const res = await h.callTool('sixflags_get_wait_times', {});
    expect(res.isError).toBeFalsy();
    const data = parseToolResult<{ attractions: { name: string; status: string; waitMinutes: number | null }[] }>(res);
    expect(data.attractions.map((a) => a.name)).toEqual(['Good', 'Weird Status']);
    expect(data.attractions[1]).toMatchObject({ status: 'UNKNOWN', waitMinutes: null });
    await h.close();
  });

  it('get_shows: a nameless show and a malformed showtime are dropped', async () => {
    const h = await attractionHarness({
      live: {
        id: 'p',
        name: 'P',
        liveData: [
          { entityType: 'SHOW', status: 'OPERATING' }, // no name
          { entityType: 'SHOW', name: 'Parade', showtimes: [{ startTime: 7 }, 'junk', { startTime: 'noon' }] },
        ],
      },
    });
    const res = await h.callTool('sixflags_get_shows', {});
    expect(res.isError).toBeFalsy();
    const data = parseToolResult<{ shows: { name: string; showtimes: { startTime: string | null }[] }[] }>(res);
    expect(data.shows.map((s) => s.name)).toEqual(['Parade']);
    expect(data.shows[0]!.showtimes.map((s) => s.startTime)).toEqual([null, 'noon']);
    await h.close();
  });

  it('get_shows: showtimes that is not an array degrades to none', async () => {
    const h = await attractionHarness({
      live: { liveData: [{ entityType: 'SHOW', name: 'Odd', showtimes: 'soon' }] },
    });
    const data = parseToolResult<{ shows: { showtimes: unknown[] }[] }>(await h.callTool('sixflags_get_shows', {}));
    expect(data.shows[0]!.showtimes).toEqual([]);
    await h.close();
  });

  it('list_attractions: a nameless child is dropped', async () => {
    const h = await attractionHarness({
      children: {
        id: 'p',
        name: 'P',
        children: [
          { id: 'x0', entityType: 'ATTRACTION' }, // no name
          { id: 'x1', name: 'Kept', entityType: 'ATTRACTION', location: 'here' },
        ],
      },
    });
    const res = await h.callTool('sixflags_list_attractions', {});
    expect(res.isError).toBeFalsy();
    const data = parseToolResult<{ attractions: { name: string; location: unknown }[] }>(res);
    expect(data.attractions).toEqual([{ id: 'x1', name: 'Kept', location: null }]);
    await h.close();
  });

  it('get_park_schedule: a dateless entry is dropped and a bad timezone falls back to UTC', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z'));
    const h = await parkHarness({
      schedule: {
        timezone: 7,
        schedule: [{ type: 'OPERATING' }, { date: '2026-07-18', type: 'OPERATING', openingTime: 'o', closingTime: 'c' }],
      },
    });
    const res = await h.callTool('sixflags_get_park_schedule', {});
    expect(res.isError).toBeFalsy();
    const data = parseToolResult<{ timezone: string | null; schedule: { date: string }[] }>(res);
    expect(data.timezone).toBeNull();
    expect(data.schedule.map((s) => s.date)).toEqual(['2026-07-18']);
    await h.close();
  });

  it('every tool survives an empty (undefined) response body', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z'));
    const { directory, spy } = makeDirectory();
    await directory.list(); // warm the park directory with the real fixture
    spy.mockResolvedValue(undefined as never);
    const h = await createTestHarness((s) => {
      registerAttractionTools(s, directory);
      registerParkTools(s, directory);
      registerWaitTimeTools(s, directory);
    });
    for (const tool of ['sixflags_get_shows', 'sixflags_list_attractions', 'sixflags_get_park_schedule', 'sixflags_get_wait_times']) {
      const res = await h.callTool(tool, {});
      expect(res.isError, tool).toBeFalsy();
    }
    await h.close();
  });
});
