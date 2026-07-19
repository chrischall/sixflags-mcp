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

// Destinations that still carry a `sixflags_destination_*` slug upstream but no
// longer belong to the chain: on 2026-04-06 six parks were divested to
// Enchanted Parks (listed at https://www.enchantedparks.com/destinations/).
// themeparks.wiki dropped Worlds of Fun, Valleyfair, and Michigan's Adventure,
// but kept these three — it even renamed the St. Louis park to "Mid-America
// Parks" while leaving the slug untouched — so the prefix filter alone still
// reports them as Six Flags parks.
//
// Keyed on the exact destination slug, NOT a name substring: only Schlitterbahn
// GALVESTON (`_GV`) was divested, while Schlitterbahn New Braunfels (`_NB`)
// remains in the chain, and a "Schlitterbahn" substring match would drop both.
// Excluding a destination drops every park under it (Six Flags St. Louis
// carries both the dry park and its Hurricane Harbor).
const DIVESTED_DESTINATION_SLUGS = new Set([
  'sixflags_destination_sfsl', // Six Flags St. Louis (upstream park name: "Mid-America Parks")
  'sixflags_destination_sfge', // Six Flags Great Escape
  'sixflags_destination_gv', // Schlitterbahn Galveston
]);

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

export interface ParkDirectoryOptions {
  /**
   * Per-user home park. The stdio server leaves this unset so the process-wide
   * `SIXFLAGS_HOME_PARK` (or the "Carowinds" default) applies exactly as before;
   * the Cloudflare connector injects the value stored in the user's OAuth props
   * so each session gets its own default without touching process state.
   * Absent or blank falls back to {@link getHomePark}.
   */
  homePark?: string;
  /** Injectable clock so TTL expiry is testable. */
  now?: () => number;
}

export class ParkDirectory {
  private cache: { parks: Park[]; fetchedAt: number } | undefined;
  private readonly now: () => number;
  private readonly homePark: string | undefined;

  constructor(
    readonly client: SixFlagsClient,
    opts: ParkDirectoryOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.homePark = opts.homePark;
  }

  /**
   * The effective home-park reference for this directory: the injected per-user
   * value when present, else the process-wide env var / built-in default.
   */
  get configuredHomePark(): string {
    return this.homePark?.trim() || getHomePark();
  }

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
      if (!slug) continue;
      const normalizedSlug = slug.toLowerCase();
      if (!normalizedSlug.startsWith(SIXFLAGS_SLUG_PREFIX)) continue;
      if (DIVESTED_DESTINATION_SLUGS.has(normalizedSlug)) continue;
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
    const query = (ref ?? this.configuredHomePark).trim();
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
