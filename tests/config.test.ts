import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHomePark, DEFAULT_HOME_PARK } from '../src/config.js';

afterEach(() => vi.unstubAllEnvs());

describe('getHomePark', () => {
  it('defaults to Carowinds when unset', () => {
    expect(getHomePark()).toBe('Carowinds');
    expect(DEFAULT_HOME_PARK).toBe('Carowinds');
  });

  it('reads SIXFLAGS_HOME_PARK when set', () => {
    vi.stubEnv('SIXFLAGS_HOME_PARK', 'Cedar Point');
    expect(getHomePark()).toBe('Cedar Point');
  });

  it('treats an unsubstituted placeholder as unset', () => {
    vi.stubEnv('SIXFLAGS_HOME_PARK', '${SIXFLAGS_HOME_PARK}');
    expect(getHomePark()).toBe('Carowinds');
  });
});
