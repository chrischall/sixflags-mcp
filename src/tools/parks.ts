import { McpServer } from '@modelcontextprotocol/server';
import { McpToolError } from '@chrischall/mcp-utils';
import { z } from 'zod';
import { lenientArray, opt, parseResponse } from '../lenient.js';
import type { ParkDirectory } from '../parks.js';
import { jsonResponse } from './_shared.js';

const scheduleEntrySchema = z.looseObject({
  date: z.string(),
  type: opt(z.string()),
  openingTime: opt(z.string()),
  closingTime: opt(z.string()),
  description: opt(z.string()),
});

const scheduleResponseSchema = z.looseObject({
  timezone: opt(z.string()),
  schedule: lenientArray(scheduleEntrySchema, 'schedule'),
});

// The park's IANA zone, or null when upstream omitted it or sent one this
// runtime does not recognise.
function validZone(timezone: string | null | undefined): string | null {
  if (!timezone) return null;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return timezone;
  } catch {
    return null;
  }
}

// Today's date (YYYY-MM-DD) in the given zone — so "today's hours" stays
// correct even when the server runs in another zone. en-CA formats as ISO
// (YYYY-MM-DD).
function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
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
      inputSchema: z.object({
        search: z
          .string()
          .describe('Case-insensitive substring to filter park or destination names')
          .optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ search }: { search?: string }) => {
      const all = await directory.list();
      // A misconfigured home park (unknown, divested, or ambiguous) makes
      // resolve() throw with a hint pointing HERE — so report it instead of
      // failing, and still list the parks the user needs to pick a valid one.
      const configuredAs = directory.configuredHomePark;
      let homePark: { name: string; parkId: string; configuredAs: string } | { configuredAs: string; error: string };
      try {
        const home = await directory.resolve();
        homePark = { name: home.name, parkId: home.parkId, configuredAs };
      } catch (err) {
        if (!(err instanceof McpToolError)) throw err;
        homePark = { configuredAs, error: err.message };
      }
      const homeId = 'parkId' in homePark ? homePark.parkId : undefined;
      const q = search?.trim().toLowerCase();
      const parks = q
        ? all.filter(
            (p) => p.name.toLowerCase().includes(q) || p.destination.toLowerCase().includes(q),
          )
        : all;
      return jsonResponse({
        homePark,
        count: parks.length,
        parks: parks.map((p) => ({
          parkId: p.parkId,
          name: p.name,
          destination: p.destination,
          isHomePark: p.parkId === homeId,
        })),
      });
    },
  );

  server.registerTool(
    'sixflags_get_park_schedule',
    {
      description:
        'Get operating hours (open/close times) for a Six Flags park, from today forward. Defaults to your home park. Use this to plan what time to arrive and how long you have.',
      inputSchema: z.object({
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
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ park, days }: { park?: string; days?: number }) => {
      const resolved = await directory.resolve(park);
      const raw = await directory.client.request<unknown>(
        'GET',
        `/v1/entity/${resolved.parkId}/schedule`,
      );
      const data = parseResponse(scheduleResponseSchema, raw, 'schedule response');

      const tz = data.timezone ?? null;
      const zone = validZone(tz);
      // Without the park's zone, today is computed in UTC — which every Six
      // Flags park (all UTC-4..-8) reaches a day early, from the local
      // evening. Start the window a day earlier so the park's current day is
      // never dropped, and say that "today" could not be pinned down.
      // `today.date` stays the UTC date string (its pre-existing value) so
      // the output shape is the same with or without a zone.
      const today = todayIn(zone ?? 'UTC');
      const from = zone ? today : addDays(today, -1);
      const horizon = addDays(today, days ?? 10);
      const entries = data.schedule
        .filter((e) => e.date >= from && e.date <= horizon)
        .sort((a, b) => a.date.localeCompare(b.date));

      const todayOperating = entries.find((e) => e.date === today && (e.type ?? '') === 'OPERATING');

      return jsonResponse({
        park: { name: resolved.name, parkId: resolved.parkId },
        timezone: tz,
        today: !zone
          ? {
              date: today,
              note: `The park's timezone is unavailable, so this date is in UTC and the park's local "today" may be ${from} instead; the schedule covers both.`,
            }
          : todayOperating
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
