import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParkDirectory } from '../src/parks.js';
import { SixFlagsClient } from '../src/client.js';
import { makeDirectory } from './_fixtures.js';

afterEach(() => vi.unstubAllEnvs());

describe('ParkDirectory.list', () => {
  it('flattens Six Flags destinations into parks, filtering non-SF and slugless ones', async () => {
    const { directory } = makeDirectory();
    const parks = await directory.list();
    expect(parks.map((p) => p.name)).toEqual([
      'Carowinds',
      'Cedar Point',
      'Cedar Point Shores',
      'Hurricane Harbor Los Angeles',
      'Six Flags Magic Mountain',
    ]);
    // Disneyland (non-SF slug), No Slug Park (no slug), and Six Flags Empty
    // (no parks) are all excluded.
  });

  it('memoizes within the TTL and refetches after it expires', async () => {
    let clock = 0;
    const { directory, spy } = makeDirectory({}, { now: () => clock });
    await directory.list();
    await directory.list();
    expect(spy).toHaveBeenCalledTimes(1); // second call served from cache

    clock += 13 * 60 * 60 * 1000; // past the 12h TTL
    await directory.list();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('degrades to an empty list when the payload shape is unexpected', async () => {
    const { directory } = makeDirectory({ destinations: {} });
    expect(await directory.list()).toEqual([]);
  });

  it('excludes destinations divested to Enchanted Parks, with all their parks', async () => {
    // Upstream still tags these `sixflags_destination_*` though the parks left
    // the chain, so the slug-prefix filter alone lets them through. Six Flags
    // St. Louis carries TWO parks — both must go.
    const { directory } = makeDirectory({
      destinations: {
        destinations: [
          {
            id: 'd-sfsl',
            name: 'Six Flags St. Louis',
            slug: 'sixflags_destination_SFSL',
            parks: [
              { id: 'p-mid-america', name: 'Mid-America Parks' },
              { id: 'p-sfsl-hh', name: 'Hurricane Harbor' },
            ],
          },
          {
            id: 'd-sfge',
            name: 'Six Flags Great Escape',
            slug: 'sixflags_destination_SFGE',
            parks: [{ id: 'p-sfge', name: 'Six Flags Great Escape' }],
          },
          {
            id: 'd-gv',
            name: 'Schlitterbahn GV',
            slug: 'sixflags_destination_GV',
            parks: [{ id: 'p-gv', name: 'Schlitterbahn GV' }],
          },
          {
            id: 'd-cw',
            name: 'Carowinds',
            slug: 'sixflags_destination_CW',
            parks: [{ id: 'p-cw', name: 'Carowinds' }],
          },
        ],
      },
    });
    expect((await directory.list()).map((p) => p.name)).toEqual(['Carowinds']);
  });

  it('keeps the Schlitterbahn park that was NOT divested', async () => {
    // Only Schlitterbahn GALVESTON (_GV) went to Enchanted Parks; New Braunfels
    // (_NB) stayed. A "Schlitterbahn" substring match would wrongly drop both,
    // which is why the denylist is keyed on the exact destination slug.
    const { directory } = makeDirectory({
      destinations: {
        destinations: [
          {
            id: 'd-nb',
            name: 'Schlitterbahn NB',
            slug: 'sixflags_destination_NB',
            parks: [{ id: 'p-nb', name: 'Schlitterbahn NB' }],
          },
        ],
      },
    });
    expect((await directory.list()).map((p) => p.name)).toEqual(['Schlitterbahn NB']);
  });

  it('matches the divested slugs case-insensitively', async () => {
    const { directory } = makeDirectory({
      destinations: {
        destinations: [
          {
            id: 'd-gv',
            name: 'Schlitterbahn GV',
            slug: 'SIXFLAGS_DESTINATION_gv',
            parks: [{ id: 'p-gv', name: 'Schlitterbahn GV' }],
          },
        ],
      },
    });
    expect(await directory.list()).toEqual([]);
  });
});

describe('ParkDirectory.resolve', () => {
  it('resolves the home park when no reference is given', async () => {
    const { directory } = makeDirectory();
    expect((await directory.resolve()).name).toBe('Carowinds');
  });

  it('honors SIXFLAGS_HOME_PARK for the default', async () => {
    vi.stubEnv('SIXFLAGS_HOME_PARK', 'Cedar Point');
    const { directory } = makeDirectory();
    expect((await directory.resolve()).parkId).toBe('p-cp');
  });

  it('resolves by exact park id', async () => {
    const { directory } = makeDirectory();
    expect((await directory.resolve('p-cp')).name).toBe('Cedar Point');
  });

  it('resolves by exact name', async () => {
    const { directory } = makeDirectory();
    expect((await directory.resolve('Cedar Point')).parkId).toBe('p-cp');
  });

  it('resolves by exact slug', async () => {
    const { directory } = makeDirectory();
    expect((await directory.resolve('sixflags_destination_CA')).name).toBe('Carowinds');
  });

  it('resolves by a unique name substring', async () => {
    const { directory } = makeDirectory();
    expect((await directory.resolve('hurricane')).name).toBe('Hurricane Harbor Los Angeles');
  });

  it('throws on an ambiguous substring', async () => {
    const { directory } = makeDirectory();
    await expect(directory.resolve('cedar')).rejects.toThrow(/multiple/i);
  });

  it('throws when nothing matches', async () => {
    const { directory } = makeDirectory();
    await expect(directory.resolve('zzz-nope')).rejects.toThrow(/No Six Flags park/i);
  });

  it('prefers an injected home park over the environment', async () => {
    vi.stubEnv('SIXFLAGS_HOME_PARK', 'Carowinds');
    const { directory } = makeDirectory({}, { homePark: 'Cedar Point' });
    expect(directory.configuredHomePark).toBe('Cedar Point');
    expect((await directory.resolve()).parkId).toBe('p-cp');
  });

  it('falls back to the environment when the injected home park is blank', async () => {
    vi.stubEnv('SIXFLAGS_HOME_PARK', 'Cedar Point');
    const { directory } = makeDirectory({}, { homePark: '   ' });
    expect(directory.configuredHomePark).toBe('Cedar Point');
    expect((await directory.resolve()).parkId).toBe('p-cp');
  });

  it('falls back to the default when no home park is injected', async () => {
    const { directory } = makeDirectory();
    expect(directory.configuredHomePark).toBe('Carowinds');
  });

  it('uses the real clock by default', async () => {
    const client = new SixFlagsClient();
    vi.spyOn(client, 'request').mockResolvedValue({ destinations: [] } as never);
    const directory = new ParkDirectory(client);
    expect(await directory.list()).toEqual([]);
  });
});
