import { parseLenient } from '@chrischall/mcp-utils';
import { z } from 'zod';

// Record-level drift tolerance for themeparks.wiki responses.
//
// `parseLenient` validates a whole response at once: if any ONE nested record
// fails, it hands back the entire raw payload unvalidated, and the handlers then
// crash on the very fields the schema promised (`undefined.localeCompare`, a
// numeric `slug.toLowerCase`). These helpers push the leniency down to the
// record: a record missing a field we genuinely need is dropped (and logged),
// its neighbours survive, and a malformed OPTIONAL field is nulled instead of
// sinking its record.

const LABEL = 'sixflags-mcp';

// Drift warnings are logged once per distinct problem per process. A field
// that changes type chain-wide is wrong in every one of a park's ~150 live
// records on every call; logging each one buries stderr (and, hosted, the log
// volume) without telling anyone anything the first line did not.
const seenWarnings = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (seenWarnings.has(key)) return;
  seenWarnings.add(key);
  console.error(`[${LABEL}] WARNING: ${message} (further identical warnings are suppressed)`);
}

/** Forget which drift warnings were already logged. For tests. */
export function resetDriftWarnings(): void {
  seenWarnings.clear();
}

function describeIssues(error: { issues: readonly z.core.$ZodIssue[] }): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/**
 * An optional field: absent, null, or malformed all read as null. A malformed
 * value is logged once (as {@link lenientArray} logs a dropped element) so
 * upstream drift is visible rather than silently erased.
 */
export function opt<T extends z.ZodType>(schema: T) {
  return schema.nullish().catch(({ error }) => {
    const issues = describeIssues(error);
    warnOnce(`opt|${issues}`, `nulling malformed optional field. ${issues}`);
    return null;
  });
}

/**
 * An array validated element by element. Elements that fail `item` are dropped
 * with a warning; a missing or non-array value reads as an empty list.
 */
export function lenientArray<T extends z.ZodType>(item: T, context: string) {
  // `.default` makes an absent key parse too: a bare `z.unknown()` key is
  // "nonoptional" in zod 4 and would fail the whole object when missing.
  return z
    .unknown()
    .transform((value): z.output<T>[] => {
    if (value == null) return [];
    if (!Array.isArray(value)) {
      warnOnce(`not-array|${context}`, `expected ${context} to be an array; ignoring it.`);
      return [];
    }
    const kept: z.output<T>[] = [];
    value.forEach((element, i) => {
      const result = item.safeParse(element);
      if (result.success) kept.push(result.data);
      else {
        // Keyed without the index: the same drift hits every element alike.
        const issues = describeIssues(result.error);
        warnOnce(`drop|${context}|${issues}`, `dropping malformed ${context}[${i}]. ${issues}`);
      }
    });
    return kept;
    })
    .default(() => []);
}

/**
 * Parse a whole upstream response. A missing body (a 204, or a 200 with an
 * empty body) or a non-object root is treated as an empty object, so a schema
 * built from {@link opt} / {@link lenientArray} fields always yields a usable
 * value rather than `undefined`.
 */
export function parseResponse<T>(schema: z.ZodType<T>, raw: unknown, context: string): T {
  let root = raw;
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    warnOnce(`not-object|${context}`, `${context} was not a JSON object; treating it as empty.`);
    root = {};
  }
  return parseLenient(schema, root, { label: LABEL, context });
}
