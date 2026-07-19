import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseLenient } from '@chrischall/mcp-utils';
import { z } from 'zod';
import type { ParkDirectory } from '../parks.js';
import { jsonResponse } from './_shared.js';

const scheduleEntrySchema = z.looseObject({
  date: z.string(),
  type: z.string().nullish(),
  openingTime: z.string().nullish(),
  closingTime: z.string().nullish(),
  description: z.string().nullish(),
});

const scheduleResponseSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  timezone: z.string().nullish(),
  schedule: z.array(scheduleEntrySchema).nullish(),
});

// Today's date (YYYY-MM-DD) in the park's own timezone — so "today's hours"
// stays correct even when the server runs in another zone. en-CA formats as
// ISO (YYYY-MM-DD).
function parkToday(timezone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    /* v8 ignore next -- only an invalid IANA zone reaches here */
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}

// Add `n` days to a YYYY-MM-DD string via UTC date math (no timezone drift for
// date-only arithmetic).
function addDays(dateStr: string, n: number): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function registerParkTools(server: McpServer, directory: ParkDirectory): void {
  server.registerTool(
    'sixflags_list_parks',
    {
      description:
        'List Six Flags parks (the combined Six Flags / Cedar Fair chain, including Carowinds, Cedar Point, Canada’s Wonderland, Magic Mountain, and the Hurricane Harbor water parks). Optionally filter by a name substring. Returns each park’s id, name, and owning destination, and flags your configured home park.',
      inputSchema: {
        search: z
          .string()
          .describe('Case-insensitive substring to filter park or destination names')
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ search }: { search?: string }) => {
      const all = await directory.list();
      const home = await directory.resolve();
      const q = search?.trim().toLowerCase();
      const parks = q
        ? all.filter(
            (p) => p.name.toLowerCase().includes(q) || p.destination.toLowerCase().includes(q),
          )
        : all;
      return jsonResponse({
        homePark: { name: home.name, parkId: home.parkId, configuredAs: directory.configuredHomePark },
        count: parks.length,
        parks: parks.map((p) => ({
          parkId: p.parkId,
          name: p.name,
          destination: p.destination,
          isHomePark: p.parkId === home.parkId,
        })),
      });
    },
  );

  server.registerTool(
    'sixflags_get_park_schedule',
    {
      description:
        'Get operating hours (open/close times) for a Six Flags park, from today forward. Defaults to your home park. Use this to plan what time to arrive and how long you have.',
      inputSchema: {
        park: z
          .string()
          .describe('Park name, slug, or id. Defaults to your home park (Carowinds).')
          .optional(),
        days: z
          .number()
          .int()
          .min(1)
          .max(60)
          .describe('How many days ahead to include (default 10)')
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ park, days }: { park?: string; days?: number }) => {
      const resolved = await directory.resolve(park);
      const raw = await directory.client.request<unknown>(
        'GET',
        `/v1/entity/${resolved.parkId}/schedule`,
      );
      const data = parseLenient(scheduleResponseSchema, raw, {
        label: 'sixflags-mcp',
        context: 'schedule response',
      });

      const tz = data.timezone ?? null;
      const today = parkToday(tz);
      const horizon = addDays(today, days ?? 10);
      const entries = (data.schedule ?? [])
        .filter((e) => e.date >= today && e.date <= horizon)
        .sort((a, b) => a.date.localeCompare(b.date));

      const todayOperating = entries.find((e) => e.date === today && (e.type ?? '') === 'OPERATING');

      return jsonResponse({
        park: { name: resolved.name, parkId: resolved.parkId },
        timezone: tz,
        today: todayOperating
          ? { date: today, opening: todayOperating.openingTime, closing: todayOperating.closingTime }
          : { date: today, note: 'No operating hours listed for today (the park may be closed).' },
        schedule: entries.map((e) => ({
          date: e.date,
          type: e.type ?? null,
          opening: e.openingTime ?? null,
          closing: e.closingTime ?? null,
          description: e.description ?? null,
        })),
      });
    },
  );
}
