import { McpToolError, parseLenient } from '@chrischall/mcp-utils';
import { z } from 'zod';
import type { SixFlagsClient } from './client.js';
import { getHomePark } from './config.js';

// themeparks.wiki groups everything under "destinations". Since the
// Six Flags / Cedar Fair merger, every park in the combined chain carries a
// `sixflags_destination_*` slug — Carowinds, Cedar Point, Canada's Wonderland,
// the Hurricane Harbor water parks, and the historically Six-Flags-branded
// parks alike. We filter on that slug prefix to enumerate "all Six Flags
// parks", then flatten each destination's `parks[]` into individual bookable
// parks (a destination like "Six Flags St. Louis" contains both the dry park
// and its Hurricane Harbor).
const SIXFLAGS_SLUG_PREFIX = 'sixflags';

// The live/schedule/children endpoints key off the PARK entity id (the id
// inside `parks[]`), NOT the destination id — mixing them up 404s.
const destinationsSchema = z.looseObject({
  destinations: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      slug: z.string().nullish(),
      parks: z
        .array(z.looseObject({ id: z.string(), name: z.string() }))
        .nullish(),
    }),
  ),
});

/** A single bookable park, flattened out of its destination. */
export interface Park {
  /** Park entity UUID — the id every live/schedule/children call uses. */
  parkId: string;
  /** Park name, e.g. "Carowinds" or "Hurricane Harbor". */
  name: string;
  /** Owning destination name, e.g. "Six Flags St. Louis". */
  destination: string;
  /** Destination slug, e.g. "sixflags_destination_CA". */
  slug: string | null;
}

// In-process cache of the park directory. The destinations list is large and
// changes at most a few times a year, so we memoize it per client instance for
// a TTL. Instance-scoped (not module-global) so each test gets clean isolation.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export class ParkDirectory {
  private cache: { parks: Park[]; fetchedAt: number } | undefined;

  constructor(
    readonly client: SixFlagsClient,
    // Injectable clock so TTL expiry is testable.
    private readonly now: () => number = Date.now,
  ) {}

  /** All Six Flags parks, sorted by name. Cached per instance for the TTL. */
  async list(): Promise<Park[]> {
    const cached = this.cache;
    if (cached && this.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.parks;

    const raw = await this.client.request<unknown>('GET', '/v1/destinations');
    const data = parseLenient(destinationsSchema, raw, {
      label: 'sixflags-mcp',
      context: 'destinations response',
    });

    const parks: Park[] = [];
    for (const dest of data.destinations ?? []) {
      const slug = dest.slug;
      if (!slug || !slug.toLowerCase().startsWith(SIXFLAGS_SLUG_PREFIX)) continue;
      for (const park of dest.parks ?? []) {
        parks.push({ parkId: park.id, name: park.name, destination: dest.name, slug });
      }
    }
    parks.sort((a, b) => a.name.localeCompare(b.name));

    this.cache = { parks, fetchedAt: this.now() };
    return parks;
  }

  /**
   * Resolve a caller-supplied park reference to a single {@link Park}. Accepts
   * (in priority order) an exact park-entity UUID, an exact case-insensitive
   * name/slug, or a unique case-insensitive substring of the name or
   * destination. `undefined` resolves the configured home park.
   *
   * Throws an {@link McpToolError} — with an actionable hint pointing at
   * `sixflags_list_parks` — when nothing matches or a substring is ambiguous.
   */
  async resolve(ref?: string): Promise<Park> {
    const query = (ref ?? getHomePark()).trim();
    const parks = await this.list();

    // 1. Exact park-entity UUID.
    const byId = parks.find((p) => p.parkId === query);
    if (byId) return byId;

    const q = query.toLowerCase();

    // 2. Exact name or slug match.
    const exact = parks.filter(
      (p) => p.name.toLowerCase() === q || p.slug?.toLowerCase() === q,
    );
    if (exact.length === 1) return exact[0]!;

    // 3. Unique substring of name or destination.
    const partial = parks.filter(
      (p) => p.name.toLowerCase().includes(q) || p.destination.toLowerCase().includes(q),
    );
    if (partial.length === 1) return partial[0]!;

    if (partial.length > 1) {
      const names = partial.map((p) => p.name).join(', ');
      throw new McpToolError(`"${query}" matches multiple Six Flags parks: ${names}.`, {
        hint: 'Pass a more specific park name or its id. Use sixflags_list_parks to see the options.',
      });
    }

    throw new McpToolError(`No Six Flags park matches "${query}".`, {
      hint: 'Use sixflags_list_parks to see the available parks and their ids.',
    });
  }
}
