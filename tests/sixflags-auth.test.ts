import { afterEach, describe, expect, it, vi } from 'vitest';
import { SixFlagsClient } from '../src/client.js';
import { sixflagsAuth } from '../src/sixflags-auth.js';
import { destinationsFixture } from './_fixtures.js';

// `login()` builds its OWN SixFlagsClient (it runs inside the Worker's
// /authorize handler, where there is no injectable instance), so the stub goes
// on the prototype rather than on an instance.
function stubDestinations() {
  return vi
    .spyOn(SixFlagsClient.prototype, 'request')
    .mockImplementation(async (_method: string, path: string) => {
      if (path === '/v1/destinations') return destinationsFixture as never;
      throw new Error(`unexpected path in test stub: ${path}`);
    });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('sixflagsAuth descriptor', () => {
  it('collects exactly one non-secret home-park field', () => {
    expect(sixflagsAuth.service).toBe('Six Flags');
    expect(sixflagsAuth.fields).toHaveLength(1);
    expect(sixflagsAuth.fields[0]!.name).toBe('homePark');
    expect(sixflagsAuth.fields[0]!.type).toBe('text');
  });

  it('states honestly that no credentials are collected', () => {
    expect(sixflagsAuth.privacyNote).toMatch(/no credentials/i);
    expect(sixflagsAuth.privacyNote).toMatch(/keyless|public/i);
  });
});

describe('sixflagsAuth.login', () => {
  it('resolves the entered park and stores its canonical name', async () => {
    const spy = stubDestinations();
    await expect(sixflagsAuth.login({ homePark: '  cedar point ' }, {})).resolves.toEqual({
      homePark: 'Cedar Point',
    });
    expect(spy).toHaveBeenCalledWith('GET', '/v1/destinations');
  });

  it('falls back to the configured default when the field is blank', async () => {
    stubDestinations();
    await expect(sixflagsAuth.login({ homePark: '   ' }, {})).resolves.toEqual({
      homePark: 'Carowinds',
    });
  });

  it('falls back to the configured default when the field is missing entirely', async () => {
    stubDestinations();
    await expect(sixflagsAuth.login({}, {})).resolves.toEqual({ homePark: 'Carowinds' });
  });

  it('honors SIXFLAGS_HOME_PARK as the blank fallback', async () => {
    vi.stubEnv('SIXFLAGS_HOME_PARK', 'Cedar Point');
    stubDestinations();
    await expect(sixflagsAuth.login({ homePark: '' }, {})).resolves.toEqual({
      homePark: 'Cedar Point',
    });
  });

  it('throws a helpful error for an unknown park', async () => {
    stubDestinations();
    await expect(sixflagsAuth.login({ homePark: 'zzz-nope' }, {})).rejects.toThrow(
      /No Six Flags park matches/i,
    );
  });

  it('throws a helpful error for an ambiguous park', async () => {
    stubDestinations();
    await expect(sixflagsAuth.login({ homePark: 'cedar' }, {})).rejects.toThrow(/multiple/i);
  });
});
