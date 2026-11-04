import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { registerParkTools, scheduleBriefLine } from '../../src/tools/parks.js';
import { registerWaitTimeTools } from '../../src/tools/waittimes.js';
import { registerAttractionTools } from '../../src/tools/attractions.js';
import { registerHealthTools } from '../../src/tools/health.js';
import { makeDirectory } from '../_fixtures.js';

/**
 * Context-group hints (`_meta.mint`, the mcp-host context-groups contract),
 * read off `tools/list` — what a host sees.
 */
type Listed = {
  name: string;
  inputSchema: { properties?: Record<string, Record<string, unknown>> };
  annotations?: { readOnlyHint?: boolean };
  _meta?: { mint?: Record<string, unknown> };
};

const DOMAINS = ['school', 'home', 'work', 'family', 'health', 'money', 'travel', 'food'];
const INTENTS = ['whats-new', 'whats-due', 'whats-on', 'lookup', 'turn-on-off', 'send', 'change', 'other'];
const KEYS = ['domain', 'intent', 'canonical', 'subject', 'when', 'aliases'];
const CANONICAL_INTENTS = ['whats-new', 'whats-due', 'whats-on'];

/** The intent every tool declares — this table is the assertion. */
const EXPECTED_INTENT: Record<string, string> = {
  sixflags_list_parks: 'lookup',
  sixflags_get_park_schedule: 'whats-on',
  sixflags_get_wait_times: 'lookup',
  sixflags_suggest_next: 'lookup',
  sixflags_list_attractions: 'lookup',
  sixflags_get_shows: 'whats-on',
};

async function served(): Promise<Listed[]> {
  const { directory } = makeDirectory();
  const h = await createTestHarness((s) => {
    registerParkTools(s, directory);
    registerWaitTimeTools(s, directory);
    registerAttractionTools(s, directory);
    registerHealthTools(s, directory);
  });
  const { tools } = await h.client.listTools();
  await h.close();
  return tools as Listed[];
}

afterEach(() => vi.useRealTimers());

describe('_meta.mint on tools/list', () => {
  it('every tool except the healthcheck is hinted, and the table names them all', async () => {
    const tools = await served();
    const hinted = tools.filter((t) => !t.name.endsWith('_healthcheck'));
    expect(hinted.map((t) => t.name).sort()).toEqual(Object.keys(EXPECTED_INTENT).sort());
    expect(tools.find((t) => t.name === 'sixflags_healthcheck')?._meta?.mint).toBeUndefined();
  });

  it.each(Object.entries(EXPECTED_INTENT))('%s declares domain travel and intent %s', async (name, intent) => {
    const mint = (await served()).find((t) => t.name === name)?._meta?.mint;
    expect(mint, name).toBeDefined();
    expect(mint!.domain).toBe('travel');
    expect(mint!.intent).toBe(intent);
  });

  it('every hint is shaped per the host contract', async () => {
    for (const t of await served()) {
      if (t.name.endsWith('_healthcheck')) continue;
      const m = t._meta!.mint!;
      const props = t.inputSchema.properties ?? {};
      expect(Object.keys(m).filter((k) => !KEYS.includes(k)), t.name).toEqual([]);
      expect(DOMAINS, t.name).toContain(m.domain);
      expect(INTENTS, t.name).toContain(m.intent);
      if ('canonical' in m) {
        expect(m.canonical, t.name).toBe(true);
        expect(t.annotations?.readOnlyHint, t.name).toBe(true);
        expect(CANONICAL_INTENTS, t.name).toContain(m.intent);
      }
      if ('subject' in m) expect(props, t.name).toHaveProperty(m.subject as string);
      if ('when' in m) {
        const when = m.when as Record<string, string>;
        expect(Object.keys(when).sort(), t.name).toEqual(['end', 'start']);
        expect(props, t.name).toHaveProperty(when.start);
        expect(props, t.name).toHaveProperty(when.end);
      }
      if ('aliases' in m) {
        const aliases = m.aliases as string[];
        expect(aliases.length, t.name).toBeLessThanOrEqual(8);
        for (const a of aliases) {
          expect(a.length, t.name).toBeLessThanOrEqual(40);
          expect(a, t.name).toBe(a.toLowerCase());
          expect(a.startsWith('sixflags_'), t.name).toBe(false);
        }
      }
    }
  });

  it('at most one canonical read per what’s-new / what’s-due / what’s-on: the park schedule for what’s-on', async () => {
    const canonical = (await served())
      .filter((t) => t._meta?.mint?.canonical === true)
      .map((t) => [t.name, t._meta!.mint!.intent]);
    expect(canonical).toEqual([['sixflags_get_park_schedule', 'whats-on']]);
    for (const intent of CANONICAL_INTENTS) {
      expect(canonical.filter(([, i]) => i === intent).length, intent).toBeLessThanOrEqual(1);
    }
  });

  it('the canonical schedule takes no subject (the chain’s parks are not the person’s subjects) and no range', async () => {
    const t = (await served()).find((x) => x.name === 'sixflags_get_park_schedule')!;
    expect(t._meta?.mint).not.toHaveProperty('subject');
    expect(t._meta?.mint).not.toHaveProperty('when');
    expect(t.inputSchema.properties).toHaveProperty('view');
    expect(t.inputSchema.properties!.view.enum).toEqual(['full', 'brief']);
  });
});

describe('sixflags_get_park_schedule view: brief', () => {
  const BRIEF = /^.+ — (\d{4}-\d{2}-\d{2}|no date) — .+$/;

  it('answers one line per schedule entry, shaped title — date — status, each ≤ 120 chars', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T14:00:00Z'));
    const { directory } = makeDirectory();
    const h = await createTestHarness((s) => registerParkTools(s, directory));
    const res = await h.callTool('sixflags_get_park_schedule', { view: 'brief' });
    await h.close();
    const text = (res.content as { type: string; text: string }[])[0].text;
    // Park names and entry descriptions are the operator's text, so the lines
    // ride in the fleet's untrusted-data envelope, minified, note first.
    expect(text).not.toContain('\n');
    expect(text.startsWith('{"untrusted_content":true,"note":')).toBe(true);
    const env = JSON.parse(text) as { untrusted_content: boolean; note: string; data: string[] };
    expect(env.note).toMatch(/themeparks\.wiki/);
    const lines = env.data;
    expect(lines).toEqual([
      'Carowinds — 2026-07-18 — open 10:00–22:00',
      'Carowinds: Early Entry for members — 2026-07-18 — info',
      'Carowinds — 2026-07-19 — open 10:00–21:00',
      'Carowinds — 2026-07-25 — open 10:00–20:00',
    ]);
    for (const l of lines) {
      expect(l).toMatch(BRIEF);
      expect(l.length).toBeLessThanOrEqual(120);
    }
  });

  it('answers the single note line `-- none` when nothing is scheduled in the window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-10T14:00:00Z'));
    const { directory } = makeDirectory();
    const h = await createTestHarness((s) => registerParkTools(s, directory));
    const res = await h.callTool('sixflags_get_park_schedule', { view: 'brief' });
    await h.close();
    expect(res.isError).toBeFalsy();
    const env = JSON.parse((res.content as { text: string }[])[0].text) as { untrusted_content: boolean; data: string[] };
    expect(env.untrusted_content).toBe(true);
    expect(env.data).toEqual(['-- none']);
  });

  it('shortens a long title to keep the line ≤ 120 chars, and falls back for missing fields', () => {
    const long = scheduleBriefLine('Carowinds', { date: '2026-07-18', type: 'TICKETED_EVENT', description: 'x'.repeat(200) });
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long).toMatch(BRIEF);
    expect(long.endsWith(' — 2026-07-18 — ticketed event')).toBe(true);
    expect(scheduleBriefLine('Carowinds', { date: '', type: 'OPERATING' })).toBe('Carowinds — no date — open');
    expect(scheduleBriefLine('Carowinds', { date: '2026-07-18', openingTime: '10am' })).toBe(
      'Carowinds — 2026-07-18 — unknown',
    );
    expect(
      scheduleBriefLine('Carowinds', { date: '2026-07-18', type: 'OPERATING', openingTime: '2026-07-18T10:00:00-04:00' }),
    ).toBe('Carowinds — 2026-07-18 — open');
  });

  it('escapes a title that starts with "-- " or "\\" with one leading backslash, so it never reads as a note', () => {
    expect(scheduleBriefLine('-- none', { date: '2026-07-18', type: 'INFO' })).toBe('\\-- none — 2026-07-18 — info');
    expect(scheduleBriefLine('\\x', { date: '2026-07-18', type: 'INFO' })).toBe('\\\\x — 2026-07-18 — info');
    expect(scheduleBriefLine('Carowinds -- x', { date: '2026-07-18', type: 'INFO' })).toBe(
      'Carowinds -- x — 2026-07-18 — info',
    );
  });

  it('cuts the line as a WHOLE, title first: an overlong status is cut too once the title is at its floor', () => {
    const l = scheduleBriefLine('Carowinds', { date: '2026-07-18', type: 'Y'.repeat(300), description: 'x'.repeat(200) });
    expect(l.length).toBeLessThanOrEqual(120);
    expect(l).toMatch(BRIEF);
    expect(l.startsWith('Carowinds: x')).toBe(true);
    expect(l.endsWith('…')).toBe(true);
    // A short title keeps all of itself and the status gives way.
    const s = scheduleBriefLine('Carowinds', { date: '2026-07-18', type: 'Y'.repeat(300) });
    expect(s.length).toBeLessThanOrEqual(120);
    expect(s.startsWith('Carowinds — 2026-07-18 — y')).toBe(true);
    // An overlong date is upstream text too: the whole line still fits.
    const d = scheduleBriefLine('Carowinds', { date: '9'.repeat(200), type: 'INFO' });
    expect(d.length).toBeLessThanOrEqual(120);
  });
});
