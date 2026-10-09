import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultHeaders, getRequestTimeoutMs } from '../src/protocol.js';

afterEach(() => vi.unstubAllEnvs());

describe('getDefaultHeaders', () => {
  it('uses the default User-Agent when SIXFLAGS_USER_AGENT is unset', () => {
    const h = getDefaultHeaders();
    expect(h.Accept).toBe('application/json');
    expect(h['User-Agent']).toContain('sixflags-mcp');
  });

  it('honors a custom SIXFLAGS_USER_AGENT', () => {
    vi.stubEnv('SIXFLAGS_USER_AGENT', 'my-agent/9');
    expect(getDefaultHeaders()['User-Agent']).toBe('my-agent/9');
  });

  it('falls back to the default when SIXFLAGS_USER_AGENT is blank', () => {
    vi.stubEnv('SIXFLAGS_USER_AGENT', '   ');
    expect(getDefaultHeaders()['User-Agent']).toContain('sixflags-mcp');
  });

  it('server.json and manifest.json state the real default User-Agent', () => {
    const defaultUa = getDefaultHeaders()['User-Agent'];
    const serverJson = JSON.parse(
      readFileSync(new URL('../server.json', import.meta.url), 'utf8'),
    ) as { packages: { environmentVariables: { name: string; description: string }[] }[] };
    const envVar = serverJson.packages
      .flatMap((p) => p.environmentVariables)
      .find((v) => v.name === 'SIXFLAGS_USER_AGENT');
    expect(envVar?.description).toContain(`Defaults to ${defaultUa}`);
    const manifest = JSON.parse(
      readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
    ) as { user_config: Record<string, { description: string }> };
    expect(manifest.user_config.sixflags_user_agent.description).toContain(
      `Defaults to ${defaultUa}`,
    );
  });
});

describe('getRequestTimeoutMs', () => {
  it('defaults to 15000 when unset', () => {
    expect(getRequestTimeoutMs()).toBe(15_000);
  });
  it('defaults when blank', () => {
    vi.stubEnv('SIXFLAGS_REQUEST_TIMEOUT_MS', '');
    expect(getRequestTimeoutMs()).toBe(15_000);
  });
  it('reads a positive integer', () => {
    vi.stubEnv('SIXFLAGS_REQUEST_TIMEOUT_MS', '5000');
    expect(getRequestTimeoutMs()).toBe(5000);
  });
  it('rejects a non-numeric value', () => {
    vi.stubEnv('SIXFLAGS_REQUEST_TIMEOUT_MS', 'abc');
    expect(getRequestTimeoutMs()).toBe(15_000);
  });
  it('rejects a non-positive value', () => {
    vi.stubEnv('SIXFLAGS_REQUEST_TIMEOUT_MS', '-5');
    expect(getRequestTimeoutMs()).toBe(15_000);
  });
});
