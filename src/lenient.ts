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

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/** An optional field: absent, null, or malformed all read as null. */
export function opt<T extends z.ZodType>(schema: T) {
  return schema.nullish().catch(null);
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
      console.error(`[${LABEL}] WARNING: expected ${context} to be an array; ignoring it.`);
      return [];
    }
    const kept: z.output<T>[] = [];
    value.forEach((element, i) => {
      const result = item.safeParse(element);
      if (result.success) kept.push(result.data);
      else
        console.error(
          `[${LABEL}] WARNING: dropping malformed ${context}[${i}]. ${describeIssues(result.error)}`,
        );
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
    console.error(`[${LABEL}] WARNING: ${context} was not a JSON object; treating it as empty.`);
    root = {};
  }
  return parseLenient(schema, root, { label: LABEL, context });
}
