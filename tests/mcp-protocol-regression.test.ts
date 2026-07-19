import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'path';
import { McpStdioClient } from '../src/mcp/index.js';

const clients: McpStdioClient[] = [];
afterEach(() => { for (const client of clients) client.close(); clients.length = 0; });

describe('MCP JSON-RPC compatibility regression', () => {
  test('stdio requests contain only standard JSON-RPC envelope fields', async () => {
    const client = new McpStdioClient('strict', {
      command: process.execPath,
      args: [join(import.meta.dir, 'fixtures', 'strict-mcp-server.ts')],
      trust: { enabled: true, allowTools: [] },
    }, 1_000);
    clients.push(client);

    await expect(client.connect()).resolves.toBeUndefined();
    await expect(client.listTools()).resolves.toEqual([]);
  });
});
