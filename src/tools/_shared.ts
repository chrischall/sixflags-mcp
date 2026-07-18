import { parseLenient, textResult } from '@chrischall/mcp-utils';
import { z } from 'zod';
import type { SixFlagsClient } from '../client.js';
import type { Park } from '../parks.js';

// Pretty-printed JSON tool result. Thin wrapper over the fleet's `textResult`
// so the tool modules keep a local, intention-revealing name.
export const jsonResponse = textResult;

// ---- themeparks.wiki /live schema -----------------------------------------

// A queue kind (STANDBY / SINGLE_RIDER). `waitTime` is minutes, or null/absent
// when the ride is closed or the wait is unpublished.
const queueEntrySchema = z.looseObject({ waitTime: z.number().nullish() });

const showtimeSchema = z.looseObject({
  type: z.string().nullish(),
  startTime: z.string().nullish(),
  endTime: z.string().nullish(),
});

const liveEntrySchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  entityType: z.string().nullish(),
  status: z.string().nullish(),
  lastUpdated: z.string().nullish(),
  queue: z
    .looseObject({
      STANDBY: queueEntrySchema.nullish(),
      SINGLE_RIDER: queueEntrySchema.nullish(),
    })
    .nullish(),
  showtimes: z.array(showtimeSchema).nullish(),
});

export const liveResponseSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  timezone: z.string().nullish(),
  liveData: z.array(liveEntrySchema).nullish(),
});
export type LiveEntry = z.infer<typeof liveEntrySchema>;

/** Fetch and validate a park's live data. */
export async function fetchLive(
  client: SixFlagsClient,
  park: Park,
): Promise<z.infer<typeof liveResponseSchema>> {
  const raw = await client.request<unknown>('GET', `/v1/entity/${park.parkId}/live`);
  return parseLenient(liveResponseSchema, raw, {
    label: 'sixflags-mcp',
    context: 'live response',
  });
}

// ---- normalized shapes the tools return -----------------------------------

export interface NormalizedAttraction {
  name: string;
  /** OPERATING | CLOSED | DOWN | REFURBISHMENT | (unknown upstream value). */
  status: string;
  /** Whether the ride is currently running (status OPERATING). */
  open: boolean;
  /** Standby wait in minutes, or null when closed / unpublished. */
  waitMinutes: number | null;
  /** Single-rider wait in minutes when the ride offers it, else null. */
  singleRiderWaitMinutes: number | null;
  lastUpdated: string | null;
}

const OPERATING = 'OPERATING';

/** True for a live entry that is a ride/attraction (not a show or eatery). */
function isAttraction(e: LiveEntry): boolean {
  return (e.entityType ?? '').toUpperCase() === 'ATTRACTION';
}

/** Normalize the ATTRACTION entries out of a live response. */
export function normalizeAttractions(
  live: z.infer<typeof liveResponseSchema>,
): NormalizedAttraction[] {
  return (live.liveData ?? []).filter(isAttraction).map((e) => {
    const status = (e.status ?? 'UNKNOWN').toUpperCase();
    const wait = e.queue?.STANDBY?.waitTime;
    const single = e.queue?.SINGLE_RIDER?.waitTime;
    return {
      name: e.name,
      status,
      open: status === OPERATING,
      waitMinutes: typeof wait === 'number' ? wait : null,
      singleRiderWaitMinutes: typeof single === 'number' ? single : null,
      lastUpdated: e.lastUpdated ?? null,
    };
  });
}

/** Whether a live response reports at least one currently-running ride. */
export function anyRideOperating(live: z.infer<typeof liveResponseSchema>): boolean {
  return (live.liveData ?? []).some(
    (e) => isAttraction(e) && (e.status ?? '').toUpperCase() === OPERATING,
  );
}

// Order attractions the way a guest scanning the park wants them: open rides
// first, longest waits at the top (that's where the crowds — and the decisions
// — are), closed/down rides after, each block alphabetized as a tiebreak.
export function byWaitDescending(a: NormalizedAttraction, b: NormalizedAttraction): number {
  if (a.open !== b.open) return a.open ? -1 : 1;
  const aw = a.waitMinutes ?? -1;
  const bw = b.waitMinutes ?? -1;
  if (aw !== bw) return bw - aw;
  return a.name.localeCompare(b.name);
}
