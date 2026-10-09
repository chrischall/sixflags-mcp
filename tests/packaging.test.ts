import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Claude Code reads a plugin's MCP config from `mcpServers`; an `mcp` key is
// silently ignored (`claude plugin validate` reports "Unknown field 'mcp'").
describe('Claude Code plugin manifest', () => {
  const plugin = JSON.parse(
    readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'),
  ) as Record<string, unknown>;

  it('declares its MCP config under mcpServers, not mcp', () => {
    expect(plugin).not.toHaveProperty('mcp');
    expect(typeof plugin.mcpServers).toBe('string');
  });

  it('points mcpServers at a file that exists', () => {
    expect(existsSync(join(root, plugin.mcpServers as string))).toBe(true);
  });
});
