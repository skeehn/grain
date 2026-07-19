import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { handleConfigShow } from '../src/commands/config.js';

const mcpPath = join(process.env.GRAIN_HOME!, 'mcp.json');
afterEach(() => rmSync(mcpPath, { force: true }));

describe('MCP configuration display regression', () => {
  test('config show reads the same GRAIN_HOME mcp.json shape as the runtime', async () => {
    writeFileSync(mcpPath, JSON.stringify({ servers: { 'computer-use': {
      command: 'npx', args: ['-y', 'computer-use-mcp@1.8.0'],
      trust: { enabled: true, allowTools: ['computer'] },
    } } }));
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try { await handleConfigShow(); } finally { console.log = original; }

    const output = lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
    expect(output).toContain('computer-use');
    expect(output).toContain('npx');
    expect(output).not.toContain('None configured');
  });
});
