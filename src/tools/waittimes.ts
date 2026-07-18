import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ParkDirectory } from '../parks.js';
import {
  anyRideOperating,
  byWaitDescending,
  fetchLive,
  jsonResponse,
  normalizeAttractions,
  type NormalizedAttraction,
} from './_shared.js';

// Summary stats over the open rides — the numbers a guest uses to read the
// crowd at a glance.
function summarize(attractions: NormalizedAttraction[]) {
  const open = attractions.filter((a) => a.open);
  const waits = open.map((a) => a.waitMinutes).filter((w): w is number => w !== null);
  // `waited` is pre-filtered to numeric waits, so the `!` assertions are safe
  // and keep these comparators branch-free.
  const waited = open.filter((a) => a.waitMinutes !== null);
  const longest = [...waited].sort((a, b) => b.waitMinutes! - a.waitMinutes!)[0];
  const shortest = [...waited].sort((a, b) => a.waitMinutes! - b.waitMinutes!)[0];
  return {
    totalAttractions: attractions.length,
    openCount: open.length,
    closedCount: attractions.length - open.length,
    averageWaitMinutes: waits.length
      ? Math.round(waits.reduce((s, w) => s + w, 0) / waits.length)
      : null,
    longestWait: longest ? { name: longest.name, waitMinutes: longest.waitMinutes } : null,
    shortestWait: shortest ? { name: shortest.name, waitMinutes: shortest.waitMinutes } : null,
  };
}

export function registerWaitTimeTools(server: McpServer, directory: ParkDirectory): void {
  server.registerTool(
    'sixflags_get_wait_times',
    {
      description:
        'Get current ride wait times for a Six Flags park (defaults to your home park, Carowinds). Returns every attraction with its status (operating/closed/down) and standby + single-rider waits, sorted longest-wait first, plus a summary of the park’s crowd level.',
      inputSchema: {
        park: z
          .string()
          .describe('Park name, slug, or id. Defaults to your home park (Carowinds).')
          .optional(),
        openOnly: z
          .boolean()
          .describe('Only return currently-operating rides (default false: include closed/down)')
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ park, openOnly }: { park?: string; openOnly?: boolean }) => {
      const resolved = await directory.resolve(park);
      const live = await fetchLive(directory.client, resolved);
      const all = normalizeAttractions(live).sort(byWaitDescending);
      const attractions = openOnly ? all.filter((a) => a.open) : all;

      return jsonResponse({
        park: { name: resolved.name, parkId: resolved.parkId },
        parkOpen: anyRideOperating(live),
        summary: summarize(all),
        attractions,
      });
    },
  );

  server.registerTool(
    'sixflags_suggest_next',
    {
      description:
        'Recommend which attraction to ride next: ranks currently-operating rides by shortest standby wait. Optionally exclude rides you’ve already done and cap the wait. Use this repeatedly through the day to keep hopping to the lowest-wait ride. Defaults to your home park (Carowinds).',
      inputSchema: {
        park: z
          .string()
          .describe('Park name, slug, or id. Defaults to your home park (Carowinds).')
          .optional(),
        exclude: z
          .array(z.string())
          .describe('Ride names (case-insensitive, substring match) to skip — e.g. ones already ridden')
          .optional(),
        maxWaitMinutes: z
          .number()
          .int()
          .min(0)
          .describe('Only suggest rides with a standby wait at or below this many minutes')
          .optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(25)
          .describe('How many suggestions to return (default 5)')
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      park,
      exclude,
      maxWaitMinutes,
      limit,
    }: {
      park?: string;
      exclude?: string[];
      maxWaitMinutes?: number;
      limit?: number;
    }) => {
      const resolved = await directory.resolve(park);
      const live = await fetchLive(directory.client, resolved);
      const excludes = (exclude ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean);

      const candidates = normalizeAttractions(live)
        // Only rides that are open and publish a real wait can be ranked.
        .filter((a) => a.open && a.waitMinutes !== null)
        .filter((a) => !excludes.some((x) => a.name.toLowerCase().includes(x)))
        // waitMinutes is non-null past the first filter → `!` is safe.
        .filter((a) => maxWaitMinutes === undefined || a.waitMinutes! <= maxWaitMinutes)
        .sort((a, b) => a.waitMinutes! - b.waitMinutes!);

      const suggestions = candidates.slice(0, limit ?? 5).map((a, i) => ({
        rank: i + 1,
        name: a.name,
        waitMinutes: a.waitMinutes,
        singleRiderWaitMinutes: a.singleRiderWaitMinutes,
      }));

      return jsonResponse({
        park: { name: resolved.name, parkId: resolved.parkId },
        parkOpen: anyRideOperating(live),
        openRidesConsidered: candidates.length,
        suggestions,
        note:
          suggestions.length === 0
            ? 'No open rides match right now — the park may be closed, or every open ride was excluded or over the wait cap.'
            : 'Ranked by shortest standby wait. Re-run after each ride (add it to `exclude`) to plan your next hop.',
      });
    },
  );
}
