import type { ConnectorAuth } from '@chrischall/mcp-connector';
import { SixFlagsClient } from './client.js';
import { ParkDirectory } from './parks.js';
import { getHomePark } from './config.js';

/**
 * OAuth props stored per user by the Cloudflare connector's OAuth provider.
 *
 * themeparks.wiki is a public, keyless API, so — unlike the setlist.fm connector
 * (which stores the user's API key) — there is NOTHING secret to keep. The one
 * thing worth remembering per user is their home park: the default every tool
 * falls back to when a call doesn't name one. `worker.ts`'s `buildClient` turns
 * this straight into a per-session `ParkDirectory`.
 *
 * The index signature satisfies `createConnector`'s
 * `Props extends Record<string, unknown>` constraint.
 */
export interface SixFlagsProps {
  homePark: string;
  [key: string]: unknown;
}

/**
 * `ConnectorAuth` for the Six Flags remote connector.
 *
 * The harness requires at least one login field (it uses the first field's value
 * as the OAuth `userId`), and since there are no credentials to collect, that
 * field is the user's home park. `login` VERIFIES it by resolving the entry
 * against the live park directory, so a typo or an ambiguous match fails on the
 * login page — where the user can fix it — rather than on every later tool call.
 *
 * The resolved park's canonical name is what gets stored, so the prop is
 * unambiguous even when the user typed a slug, an id, or a partial name.
 */
export const sixflagsAuth: ConnectorAuth<SixFlagsProps> = {
  service: 'Six Flags',
  accent: '#E4002B',
  privacyNote:
    'No credentials are collected or stored — Six Flags wait times come from the public, keyless themeparks.wiki API. ' +
    'The home park you enter is saved only as your default park for tools that don’t name one.',
  fields: [{ name: 'homePark', label: 'Home park (name, slug, or park id)', type: 'text' }],
  async login(fields) {
    // The login page marks the input `required`, but that is client-side only —
    // a raw POST can still submit an empty value, and the harness coerces a
    // missing field to ''. Treat blank as "use the configured default".
    const entered = (fields.homePark ?? '').trim() || getHomePark();

    // Verify against the live directory. `resolve` throws an McpToolError with an
    // actionable message ("matches multiple Six Flags parks: …" / "No Six Flags
    // park matches …") which the connector surfaces back on the login page.
    // This runs inside the /authorize POST handler — never at module scope,
    // which would trip Worker startup validation.
    const directory = new ParkDirectory(new SixFlagsClient());
    const park = await directory.resolve(entered);
    return { homePark: park.name };
  },
};
