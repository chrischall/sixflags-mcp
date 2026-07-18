import { describe, expect, it } from 'vitest';
import {
  anyRideOperating,
  byWaitDescending,
  normalizeAttractions,
  type NormalizedAttraction,
} from '../../src/tools/_shared.js';
import { liveResponseSchema } from '../../src/tools/_shared.js';
import type { z } from 'zod';

type Live = z.infer<typeof liveResponseSchema>;

function live(entries: unknown[]): Live {
  return { id: 'p', name: 'P', liveData: entries } as Live;
}

describe('normalizeAttractions', () => {
  it('keeps only ATTRACTION entries and normalizes their fields', () => {
    const out = normalizeAttractions(
      live([
        { entityType: 'ATTRACTION', name: 'A', status: 'operating', queue: { STANDBY: { waitTime: 10 }, SINGLE_RIDER: { waitTime: 5 } }, lastUpdated: 't' },
        { entityType: 'ATTRACTION', name: 'B' }, // no status/queue
        { entityType: 'ATTRACTION', name: 'C', status: 'CLOSED', queue: { STANDBY: { waitTime: null } } },
        { entityType: 'SHOW', name: 'S', status: 'OPERATING' }, // dropped
        { name: 'NoType' }, // no entityType → dropped
      ]),
    );
    expect(out).toEqual<NormalizedAttraction[]>([
      { name: 'A', status: 'OPERATING', open: true, waitMinutes: 10, singleRiderWaitMinutes: 5, lastUpdated: 't' },
      { name: 'B', status: 'UNKNOWN', open: false, waitMinutes: null, singleRiderWaitMinutes: null, lastUpdated: null },
      { name: 'C', status: 'CLOSED', open: false, waitMinutes: null, singleRiderWaitMinutes: null, lastUpdated: null },
    ]);
  });

  it('handles a null liveData array', () => {
    expect(normalizeAttractions({ id: 'p', name: 'P' } as Live)).toEqual([]);
  });
});

describe('anyRideOperating', () => {
  it('is true when an attraction is operating', () => {
    expect(anyRideOperating(live([{ entityType: 'ATTRACTION', name: 'A', status: 'OPERATING' }]))).toBe(true);
  });
  it('is false when none are operating (a show operating does not count)', () => {
    expect(
      anyRideOperating(
        live([
          { entityType: 'ATTRACTION', name: 'A', status: 'CLOSED' },
          { entityType: 'SHOW', name: 'S', status: 'OPERATING' },
        ]),
      ),
    ).toBe(false);
  });

  it('is false when liveData is absent', () => {
    expect(anyRideOperating({ id: 'p', name: 'P' } as Live)).toBe(false);
  });

  it('is false for a statusless attraction', () => {
    expect(anyRideOperating(live([{ entityType: 'ATTRACTION', name: 'x' }]))).toBe(false);
  });
});

describe('byWaitDescending', () => {
  const mk = (name: string, open: boolean, waitMinutes: number | null): NormalizedAttraction => ({
    name,
    status: open ? 'OPERATING' : 'CLOSED',
    open,
    waitMinutes,
    singleRiderWaitMinutes: null,
    lastUpdated: null,
  });

  it('orders open-first, then longest wait, then name', () => {
    const sorted = [
      mk('Zebra', false, null),
      mk('Beta', true, 30),
      mk('Alpha', true, 30),
      mk('Gamma', true, 75),
      mk('Aardvark', false, null),
    ].sort(byWaitDescending);
    expect(sorted.map((a) => a.name)).toEqual(['Gamma', 'Alpha', 'Beta', 'Aardvark', 'Zebra']);
  });
});
