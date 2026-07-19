// Single source of truth for the server version. release-please bumps the
// string below via the `x-release-please-version` marker (registered in
// release-please-config.json's `extra-files`), and `versionSyncTest` guards
// that it stays equal to package.json. Import VERSION wherever the version is
// needed rather than re-declaring it — notably from BOTH entry points, since
// src/worker.ts must never import the stdio entry (src/index.ts).
export const VERSION = '1.0.0'; // x-release-please-version
