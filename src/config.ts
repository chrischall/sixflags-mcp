import { readEnvVar } from '@chrischall/mcp-utils';

// The user's home park. Every tool defaults to this when the caller doesn't
// name a park, so "what are the wait times?" just works. Defaults to Carowinds
// (the project author's home park); override with SIXFLAGS_HOME_PARK, which may
// be a park name, a themeparks.wiki slug, or a park entity UUID — it is run
// through the same resolver as the per-call `park` argument.
export const DEFAULT_HOME_PARK = 'Carowinds';

export function getHomePark(): string {
  return readEnvVar('SIXFLAGS_HOME_PARK') ?? DEFAULT_HOME_PARK;
}
