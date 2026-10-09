import { createApiClient, loadDotenvSafely, McpToolError, type ApiClient } from '@chrischall/mcp-utils';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { BASE_URL, getDefaultHeaders, getRequestTimeoutMs } from './protocol.js';

// Load .env for local dev; silently skip if dotenv is unavailable (e.g. inside
// the mcpb bundle). loadDotenvSafely applies override:false + quiet:true and
// swallows a missing dotenv module. There are no secrets to load here (the
// upstream is keyless) — this only picks up optional knobs like
// SIXFLAGS_HOME_PARK for `npm run dev`.
try {
  const dir = dirname(fileURLToPath(import.meta.url));
  await loadDotenvSafely({ path: join(dir, '..', '.env') });
} catch {
  /* v8 ignore next -- only reached in a non-Node runtime where import.meta.url is undefined */
}

// Thin wrapper over the shared bearer-client kit, configured with NO token
// resolver (themeparks.wiki is a public, keyless API — `getToken` is optional
// and omitting it sends no Authorization header). The wrapper exists so tools
// and tests depend on a stable `request<T>(method, path)` surface rather than
// the raw ApiClient, mirroring the sibling MCPs in the fleet.
export class SixFlagsClient {
  private readonly api: ApiClient;

  constructor(opts?: { fetchImpl?: typeof fetch }) {
    this.api = createApiClient({
      baseUrl: BASE_URL,
      baseHeaders: getDefaultHeaders(),
      serviceName: 'themeparks.wiki',
      timeout: getRequestTimeoutMs(),
      ...(opts?.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
  }

  /**
   * GET a JSON resource. Throws a redacted, truncated error on non-2xx.
   *
   * Cancellation needs nothing here: the shared client aborts the fetch on the
   * running tool call's ambient signal (mcp-utils `cancel`), which `runMcp`
   * sets for every handler.
   */
  async request<T>(method: string, path: string): Promise<T> {
    try {
      return await this.api.fetchJson<T>(method, path);
    } catch (err) {
      // fetchJson JSON.parses any non-empty 2xx body, so an HTML interstitial
      // or outage page would otherwise surface as a bare SyntaxError that
      // names neither the service nor the request.
      if (!(err instanceof SyntaxError)) throw err;
      throw new McpToolError(
        `themeparks.wiki returned a non-JSON response for ${method} ${path} (likely an outage or CDN interstitial page).`,
        { hint: 'This is an upstream problem; try again in a few minutes. sixflags_healthcheck reports whether themeparks.wiki is reachable.' },
      );
    }
  }
}

export const client = new SixFlagsClient();
