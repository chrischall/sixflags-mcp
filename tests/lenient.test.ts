import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { lenientArray, opt, parseResponse, resetDriftWarnings } from '../src/lenient.js';

describe('opt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetDriftWarnings();
  });

  const schema = z.object({ name: opt(z.string()) });

  it('reads an absent or null field as null without warning', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(schema.parse({})).toEqual({ name: undefined });
    expect(schema.parse({ name: null })).toEqual({ name: null });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('keeps a valid value without warning', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(schema.parse({ name: 'Goliath' })).toEqual({ name: 'Goliath' });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('nulls a malformed field and logs a warning, like lenientArray does for elements', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(schema.parse({ name: 42 })).toEqual({ name: null });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = String(errorSpy.mock.calls[0]?.[0]);
    expect(message).toContain('[sixflags-mcp] WARNING');
    expect(message).toContain('malformed optional field');
    expect(message).toMatch(/expected string/i);
  });
});

describe('lenientArray', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetDriftWarnings();
  });

  it('drops a malformed element and logs it', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const schema = z.object({ items: lenientArray(z.string(), 'items') });

    expect(schema.parse({ items: ['a', 1, 'b'] })).toEqual({ items: ['a', 'b'] });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('dropping malformed items[1]');
  });
});

describe('drift warnings are bounded', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetDriftWarnings();
  });

  it('logs a persistently malformed optional field once, not on every record or call', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const schema = z.object({ rows: z.array(z.object({ name: opt(z.string()) })) });
    const payload = { rows: Array.from({ length: 150 }, () => ({ name: 5 })) };

    schema.parse(payload);
    schema.parse(payload); // a second tool call over the same drift
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toMatch(/further identical warnings are suppressed/);
  });

  it('logs each distinct drift once', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const schema = z.object({ n: opt(z.string()), m: opt(z.number()) });

    schema.parse({ n: 1, m: 'x' });
    schema.parse({ n: 1, m: 'x' });
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it('logs a repeatedly dropped array element once regardless of its index', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const schema = z.object({ items: lenientArray(z.string(), 'items') });

    expect(schema.parse({ items: [1, 2, 'a', 3] })).toEqual({ items: ['a'] });
    schema.parse({ items: [4] });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('dropping malformed items[0]');
  });

  it('logs a non-array value and a non-object body once each', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const schema = z.object({ items: lenientArray(z.string(), 'items') });

    schema.parse({ items: 'nope' });
    schema.parse({ items: 'nope' });
    parseResponse(schema, 'oops', 'test response');
    parseResponse(schema, 'oops', 'test response');
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });
});
