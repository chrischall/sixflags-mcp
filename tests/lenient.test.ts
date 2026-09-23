import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { lenientArray, opt } from '../src/lenient.js';

describe('opt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
  });

  it('drops a malformed element and logs it', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const schema = z.object({ items: lenientArray(z.string(), 'items') });

    expect(schema.parse({ items: ['a', 1, 'b'] })).toEqual({ items: ['a', 'b'] });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('dropping malformed items[1]');
  });
});
