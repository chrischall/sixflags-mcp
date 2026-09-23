import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerParkTools } from '../../src/tools/parks.js';
import { makeDirectory, scheduleFixture } from '../_fixtures.js';
import type { ParkDirectoryOptions } from '../../src/parks.js';

async function harnessFor(overrides = {}, opts: ParkDirectoryOptions = {}) {
  const { directory } = makeDirectory(overrides, opts);
  const h = await createTestHarness((s) => registerParkTools(s, directory));
  return h;
}

afterEach(() => vi.useRealTimers());

describe('sixflags_list_parks', () => {
  it('lists all parks and flags the home park', async () => {
    const h = await harnessFor();
    const data = parseToolResult<{ homePark: { name: string }; count: number; parks: { name: string; isHomePark: boolean }[] }>(
      await h.callTool('sixflags_list_parks', {}),
    );
    expect(data.homePark.name).toBe('Carowinds');
    expect(data.count).toBe(5);
    expect(data.parks.find((p) => p.isHomePark)?.name).toBe('Carowinds');
    await h.close();
  });

  it('reports the per-directory home park in configuredAs', async () => {
    const h = await harnessFor({}, { homePark: 'Cedar Point' });
    const data = parseToolResult<{ homePark: { name: string; parkId: string; configuredAs: string } }>(
      await h.callTool('sixflags_list_parks', {}),
    );
    expect(data.homePark.configuredAs).toBe('Cedar Point');
    expect(data.homePark.parkId).toBe('p-cp');
    await h.close();
  });

  it('still lists the parks when the configured home park is ambiguous or unknown', async () => {
    // resolve() throws for these, and its hint points at sixflags_list_parks —
    // so list_parks must not throw the same error back.
    // 'Cedar' is ambiguous (Cedar Point / Cedar Point Shores); 'Great Escape'
    // was divested and filtered out of the directory.
    for (const ref of ['Cedar', 'Great Escape']) {
      const h = await harnessFor({}, { homePark: ref });
      const res = await h.callTool('sixflags_list_parks', {});
      expect(res.isError, ref).toBeFalsy();
      const data = parseToolResult<{
        homePark: { configuredAs: string; error?: string; name?: string };
        count: number;
        parks: { isHomePark: boolean }[];
      }>(res);
      expect(data.count).toBe(5);
      expect(data.homePark.configuredAs).toBe(ref);
      expect(data.homePark.error).toMatch(ref === 'Cedar' ? /matches multiple/ : /No Six Flags park matches/);
      expect(data.homePark.name).toBeUndefined();
      expect(data.parks.every((p) => !p.isHomePark)).toBe(true);
      await h.close();
    }
  });

  it('still propagates an unexpected (non-tool) failure from resolving the home park', async () => {
    const { directory } = makeDirectory();
    vi.spyOn(directory, 'resolve').mockRejectedValue(new Error('upstream down'));
    const h = await createTestHarness((s) => registerParkTools(s, directory));
    const res = await h.callTool('sixflags_list_parks', {});
    expect(res.isError).toBe(true);
    await h.close();
  });

  it('filters by a search substring', async () => {
    const h = await harnessFor();
    const data = parseToolResult<{ count: number; parks: { name: string }[] }>(
      await h.callTool('sixflags_list_parks', { search: 'cedar' }),
    );
    expect(data.parks.map((p) => p.name)).toEqual(['Cedar Point', 'Cedar Point Shores']);
    await h.close();
  });
});

describe('sixflags_get_park_schedule', () => {
  it('returns today plus upcoming operating days within the horizon', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T14:00:00Z'));
    const h = await harnessFor();
    const data = parseToolResult<{ today: { date: string; opening?: string }; schedule: { date: string }[] }>(
      await h.callTool('sixflags_get_park_schedule', {}),
    );
    expect(data.today.date).toBe('2026-07-18');
    expect(data.today.opening).toBe('2026-07-18T10:00:00-04:00');
    // Default 10-day horizon: 07-18, 07-19, 07-25 (OPERATING) + the 07-18 INFO
    // entry; the past 07-01 is excluded.
    expect(data.schedule.map((s) => s.date)).toEqual(['2026-07-18', '2026-07-18', '2026-07-19', '2026-07-25']);
    await h.close();
  });

  it('narrows the horizon with the days argument', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T14:00:00Z'));
    const h = await harnessFor();
    const data = parseToolResult<{ schedule: { date: string }[] }>(
      await h.callTool('sixflags_get_park_schedule', { days: 2 }),
    );
    expect(new Set(data.schedule.map((s) => s.date))).toEqual(new Set(['2026-07-18', '2026-07-19']));
    await h.close();
  });

  it('notes when the park is closed today', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T14:00:00Z'));
    const h = await harnessFor();
    const data = parseToolResult<{ today: { date: string; note?: string } }>(
      await h.callTool('sixflags_get_park_schedule', {}),
    );
    expect(data.today.date).toBe('2026-07-22');
    expect(data.today.note).toMatch(/closed/i);
    await h.close();
  });

  it('falls back to UTC when the timezone is invalid', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T14:00:00Z'));
    const h = await harnessFor({ schedule: { ...scheduleFixture, timezone: 'Not/AZone' } });
    const data = parseToolResult<{ timezone: string; today: { date: string } }>(
      await h.callTool('sixflags_get_park_schedule', {}),
    );
    expect(data.timezone).toBe('Not/AZone');
    expect(data.today.date).toBe('2026-07-18'); // UTC fallback still lands on the 18th
    await h.close();
  });
});
