import { describe, expect, it } from 'vitest';
import { versionSyncTest } from '@chrischall/mcp-utils/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.js';

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

  // src/version.ts is the single source of truth both entry points read: the
  // stdio server (src/index.ts) and the Cloudflare Worker connector
  // (src/worker.ts, which must never import the stdio entry). Asserting the
  // export directly guards the value AND keeps the module covered under the
  // 100% gate, since a bare `export const` module is otherwise never imported
  // by the node suite.
  it('src/version.ts VERSION equals package.json#version', () => {
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });
});
