import { describe, expect, it, vi } from 'vitest';
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
});
