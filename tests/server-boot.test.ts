import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Drive the initialize + tools/list handshake against a REAL built artifact
// over stdio, and return the advertised tool names. Catches an eager-import
// crash in the .mcpb bundle and a wrong `bin` path — neither of which the
// mocked unit tests would see.
function handshake(entry: string, cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [entry], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => {
      out += c;
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2) {
            child.kill();
            resolve(msg.result.tools.map((t: { name: string }) => t.name));
          }
        } catch {
          /* partial line — keep buffering */
        }
      }
    });
    child.stderr.on('data', (c) => (err += c));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code && code !== 0) reject(new Error(`server exited ${code}: ${err}`));
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n',
    );
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  });
}

describe('server boot', () => {
  beforeAll(() => {
    // Ensure the artifacts exist (CI builds first, but a bare local `npm test`
    // may not have).
    if (!existsSync(join(repoRoot, 'dist', 'index.js')) || !existsSync(join(repoRoot, 'dist', 'bundle.js'))) {
      execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'ignore' });
    }
  }, 120_000);

  it('the bin entry (with node_modules) lists all tools', async () => {
    const tools = await handshake(join(repoRoot, 'dist', 'index.js'), repoRoot);
    expect(tools).toContain('sixflags_get_wait_times');
    expect(tools.length).toBeGreaterThanOrEqual(7);
  }, 30_000);

  it('the esbuild bundle boots with NO node_modules (the .mcpb runtime)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sixflags-boot-'));
    try {
      const bundle = join(dir, 'bundle.js');
      copyFileSync(join(repoRoot, 'dist', 'bundle.js'), bundle);
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
      const tools = await handshake(bundle, dir);
      expect(tools.length).toBeGreaterThanOrEqual(7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
