import { describe, expect, it, vi } from 'vitest';
import { withCallSignal } from '@chrischall/mcp-utils';
import { SixFlagsClient } from '../src/client.js';

describe('SixFlagsClient', () => {
  it('constructs without a fetch override', () => {
    expect(new SixFlagsClient()).toBeInstanceOf(SixFlagsClient);
  });

  it('routes requests through an injected fetch and returns parsed JSON', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ destinations: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = new SixFlagsClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const data = await client.request<{ destinations: unknown[] }>('GET', '/v1/destinations');

    expect(data).toEqual({ destinations: [] });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const url = (fetchImpl.mock.calls[0]![0] as URL | string).toString();
    expect(url).toBe('https://api.themeparks.wiki/v1/destinations');
  });

  it("aborts the upstream request when the tool call is cancelled", async () => {
    let seen: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = new SixFlagsClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const call = new AbortController();
    await withCallSignal(call.signal, () => client.request('GET', '/v1/destinations'));
    expect(seen?.aborted).toBe(false);
    call.abort();
    expect(seen?.aborted).toBe(true);
  });

  it('reports a non-JSON 200 body (an HTML interstitial) as a themeparks.wiki error, not a raw SyntaxError', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html>Just a moment...</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    const client = new SixFlagsClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const err = await client.request('GET', '/v1/destinations').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(SyntaxError);
    expect(String((err as Error).message)).toMatch(/themeparks\.wiki/);
    expect(String((err as Error).message)).toContain('/v1/destinations');
  });

  it('passes through errors that are not JSON parse failures', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down');
    });
    const client = new SixFlagsClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.request('GET', '/v1/destinations')).rejects.toThrow('network down');
  });
});
