import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseLenient } from '@chrischall/mcp-utils';
import { z } from 'zod';
import type { ParkDirectory } from '../parks.js';
import { fetchLive, jsonResponse } from './_shared.js';

const childSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  entityType: z.string().nullish(),
  location: z
    .looseObject({ latitude: z.number().nullish(), longitude: z.number().nullish() })
    .nullish(),
});

const childrenResponseSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  children: z.array(childSchema).nullish(),
});

export function registerAttractionTools(server: McpServer, directory: ParkDirectory): void {
  server.registerTool(
    'sixflags_list_attractions',
    {
      description:
        'List the attractions (or shows / restaurants) at a Six Flags park — the full directory of what’s there, with map coordinates. Static metadata, not live status; use sixflags_get_wait_times for current waits. Defaults to your home park (Carowinds).',
      inputSchema: {
        park: z
          .string()
          .describe('Park name, slug, or id. Defaults to your home park (Carowinds).')
          .optional(),
        type: z
          .enum(['ATTRACTION', 'SHOW', 'RESTAURANT'])
          .describe('Which kind of entity to list (default ATTRACTION)')
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ park, type }: { park?: string; type?: 'ATTRACTION' | 'SHOW' | 'RESTAURANT' }) => {
      const resolved = await directory.resolve(park);
      const raw = await directory.client.request<unknown>(
        'GET',
        `/v1/entity/${resolved.parkId}/children`,
      );
      const data = parseLenient(childrenResponseSchema, raw, {
        label: 'sixflags-mcp',
        context: 'children response',
      });

      const want = type ?? 'ATTRACTION';
      const items = (data.children ?? [])
        .filter((c) => (c.entityType ?? '').toUpperCase() === want)
        .map((c) => ({
          id: c.id,
          name: c.name,
          location:
            c.location && (c.location.latitude != null || c.location.longitude != null)
              ? { latitude: c.location.latitude ?? null, longitude: c.location.longitude ?? null }
              : null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return jsonResponse({
        park: { name: resolved.name, parkId: resolved.parkId },
        type: want,
        count: items.length,
        attractions: items,
      });
    },
  );

  server.registerTool(
    'sixflags_get_shows',
    {
      description:
        'Get today’s live show schedule (showtimes) for a Six Flags park — parades, stunt shows, character meets. Defaults to your home park (Carowinds). Showtimes are only populated on operating days.',
      inputSchema: {
        park: z
          .string()
          .describe('Park name, slug, or id. Defaults to your home park (Carowinds).')
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ park }: { park?: string }) => {
      const resolved = await directory.resolve(park);
      const live = await fetchLive(directory.client, resolved);

      const shows = (live.liveData ?? [])
        .filter((e) => (e.entityType ?? '').toUpperCase() === 'SHOW')
        .map((e) => ({
          name: e.name,
          status: (e.status ?? 'UNKNOWN').toUpperCase(),
          showtimes: (e.showtimes ?? []).map((s) => ({
            type: s.type ?? null,
            startTime: s.startTime ?? null,
            endTime: s.endTime ?? null,
          })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const withTimes = shows.filter((s) => s.showtimes.length > 0).length;
      return jsonResponse({
        park: { name: resolved.name, parkId: resolved.parkId },
        showCount: shows.length,
        showsWithScheduledTimes: withTimes,
        shows,
      });
    },
  );
}
