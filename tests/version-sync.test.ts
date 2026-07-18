import { describe, expect, it } from 'vitest';
import { versionSyncTest } from '@chrischall/mcp-utils/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Release-please bumps the `x-release-please-version` marker in src/*.ts in
// lockstep with package.json#version. This guard fails the release PR's CI if
// any marker drifts.
describe('version sync', () => {
  it('every x-release-please-version marker matches package.json', () => {
    const mismatches = versionSyncTest({
      srcDir: join(here, '..', 'src'),
      pkgPath: join(here, '..', 'package.json'),
    });
    expect(mismatches).toEqual([]);
  });
});
