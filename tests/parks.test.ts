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
    const { directory, spy } = makeDirectory({}, () => clock);
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

  it('uses the real clock by default', async () => {
    const client = new SixFlagsClient();
    vi.spyOn(client, 'request').mockResolvedValue({ destinations: [] } as never);
    const directory = new ParkDirectory(client);
    expect(await directory.list()).toEqual([]);
  });
});
