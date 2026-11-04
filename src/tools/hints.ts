/**
 * Context-group hints, published on each tool as `_meta.mint` (the mcp-host
 * context-groups contract). Inert data: a host that does not read them sees
 * an extra `_meta` key and nothing else. The shape is fixed by the host's
 * contract, so it is restated here rather than imported.
 *
 * Every tool here is in the `travel` group. There is no `subject`: the
 * subjects a host fans out over are the person's own (children, properties,
 * accounts), and the chain's parks are a public directory, not that — the
 * person's park is the configured home park, which every tool defaults to.
 * `aliases` are the words a person says (lowercase, ≤ 8, each ≤ 40 chars).
 */
export type MintIntent =
  | 'whats-new' | 'whats-due' | 'whats-on' | 'lookup' | 'turn-on-off' | 'send' | 'change' | 'other';

export interface MintHint {
  domain: 'travel';
  intent: MintIntent;
  canonical?: true;
  subject?: string;
  when?: { start: string; end: string };
  aliases?: string[];
}

/** `_meta` for a Six Flags tool. */
export function travelMeta(
  intent: MintIntent,
  extra: Omit<MintHint, 'domain' | 'intent'> = {},
): { mint: MintHint } {
  return { mint: { domain: 'travel', intent, ...extra } };
}
