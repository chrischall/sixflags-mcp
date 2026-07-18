import { vi } from 'vitest';
import { SixFlagsClient } from '../src/client.js';
import { ParkDirectory } from '../src/parks.js';

// A destinations payload exercising the slug filter (Six Flags in, others out),
// multi-park destinations, a destination with no slug, and one with no parks.
export const destinationsFixture = {
  destinations: [
    {
      id: 'd-caro',
      name: 'Carowinds',
      slug: 'sixflags_destination_CA',
      parks: [{ id: 'p-caro', name: 'Carowinds' }],
    },
    {
      id: 'd-cp',
      name: 'Cedar Point',
      slug: 'sixflags_destination_CP',
      parks: [
        { id: 'p-cp', name: 'Cedar Point' },
        { id: 'p-cps', name: 'Cedar Point Shores' },
      ],
    },
    {
      id: 'd-mm',
      name: 'Six Flags Magic Mountain',
      slug: 'sixflags_destination_SFMM',
      parks: [
        { id: 'p-mm', name: 'Six Flags Magic Mountain' },
        { id: 'p-hh', name: 'Hurricane Harbor Los Angeles' },
      ],
    },
    // Filtered out — not a Six Flags slug.
    { id: 'd-dis', name: 'Disneyland', slug: 'disney_destination', parks: [{ id: 'p-dl', name: 'Disneyland' }] },
    // Filtered out — no slug at all.
    { id: 'd-noslug', name: 'No Slug Park', parks: [{ id: 'p-ns', name: 'No Slug Park' }] },
    // Kept by slug but contributes no parks (parks omitted).
    { id: 'd-empty', name: 'Six Flags Empty', slug: 'sixflags_destination_E' },
  ],
};

// A live payload with a spread of attraction states + shows + a restaurant.
export const liveFixture = {
  id: 'p-caro',
  name: 'Carowinds',
  timezone: 'America/New_York',
  liveData: [
    {
      entityType: 'ATTRACTION',
      name: 'Fury 325',
      status: 'operating', // lowercase → exercises the uppercasing
      lastUpdated: '2026-07-18T15:00:00Z',
      queue: { STANDBY: { waitTime: 75 }, SINGLE_RIDER: { waitTime: 20 } },
    },
    {
      entityType: 'ATTRACTION',
      name: 'Afterburn',
      status: 'OPERATING',
      lastUpdated: '2026-07-18T15:00:00Z',
      queue: { STANDBY: { waitTime: 30 } },
    },
    {
      entityType: 'ATTRACTION',
      name: 'Carolina Cyclone',
      status: 'OPERATING',
      lastUpdated: '2026-07-18T15:00:00Z',
      queue: { STANDBY: { waitTime: 30 } }, // ties Afterburn → alphabetical tiebreak
    },
    {
      entityType: 'ATTRACTION',
      name: 'Intimidator',
      status: 'DOWN',
      queue: { STANDBY: {} }, // down, no published wait
    },
    { entityType: 'ATTRACTION', name: 'Nighthawk', status: 'CLOSED' }, // no queue at all
    {
      entityType: 'SHOW',
      name: 'Character Meet',
      status: 'OPERATING',
      showtimes: [
        { type: 'Meet & Greet', startTime: '2026-07-18T13:00:00-04:00', endTime: '2026-07-18T13:30:00-04:00' },
      ],
    },
    { entityType: 'SHOW', name: 'Silent Show', status: 'OPERATING' }, // no showtimes
    { entityType: 'SHOW', name: 'Statusless Show' }, // no status → UNKNOWN
    { entityType: 'RESTAURANT', name: 'Food Place', status: 'OPERATING' }, // ignored by attractions
  ],
};

// A live payload with the park fully closed (no operating attraction).
export const closedLiveFixture = {
  id: 'p-caro',
  name: 'Carowinds',
  timezone: 'America/New_York',
  liveData: [{ entityType: 'ATTRACTION', name: 'Fury 325', status: 'CLOSED', queue: { STANDBY: {} } }],
};

export const scheduleFixture = {
  id: 'p-caro',
  name: 'Carowinds',
  timezone: 'America/New_York',
  schedule: [
    { date: '2026-07-18', type: 'OPERATING', openingTime: '2026-07-18T10:00:00-04:00', closingTime: '2026-07-18T22:00:00-04:00' },
    { date: '2026-07-19', type: 'OPERATING', openingTime: '2026-07-19T10:00:00-04:00', closingTime: '2026-07-19T21:00:00-04:00' },
    { date: '2026-07-25', type: 'OPERATING', openingTime: '2026-07-25T10:00:00-04:00', closingTime: '2026-07-25T20:00:00-04:00' },
    { date: '2026-07-01', type: 'OPERATING', openingTime: '2026-07-01T10:00:00-04:00', closingTime: '2026-07-01T20:00:00-04:00' },
    { date: '2026-07-18', type: 'INFO', description: 'Early Entry for members' },
  ],
};

export const childrenFixture = {
  id: 'p-caro',
  name: 'Carowinds',
  children: [
    { id: 'c1', name: 'Fury 325', entityType: 'ATTRACTION', location: { latitude: 35.1, longitude: -80.9 } },
    { id: 'c2', name: 'Carolina Cyclone', entityType: 'ATTRACTION', location: { longitude: -80.94 } }, // lat absent
    { id: 'c3', name: 'No Loc Ride', entityType: 'ATTRACTION' }, // no location key
    { id: 'c4', name: 'Empty Loc Ride', entityType: 'ATTRACTION', location: {} }, // both null
    { id: 'c5', name: 'A Show', entityType: 'SHOW' },
    { id: 'c6', name: 'Grill', entityType: 'RESTAURANT' },
  ],
};

export interface StubOverrides {
  destinations?: unknown;
  live?: unknown;
  schedule?: unknown;
  children?: unknown;
}

/**
 * Build a {@link ParkDirectory} whose client's `request` is stubbed to route by
 * path to the given fixtures. Returns the directory and the spy so a test can
 * assert call counts (e.g. the memoization cache).
 */
export function makeDirectory(overrides: StubOverrides = {}, now?: () => number) {
  const client = new SixFlagsClient();
  const spy = vi.spyOn(client, 'request').mockImplementation(async (_method: string, path: string) => {
    if (path === '/v1/destinations') return (overrides.destinations ?? destinationsFixture) as never;
    if (path.endsWith('/live')) return (overrides.live ?? liveFixture) as never;
    if (path.endsWith('/schedule')) return (overrides.schedule ?? scheduleFixture) as never;
    if (path.endsWith('/children')) return (overrides.children ?? childrenFixture) as never;
    throw new Error(`unexpected path in test stub: ${path}`);
  });
  const directory = new ParkDirectory(client, now);
  return { client, directory, spy };
}
