import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'path';
import { McpHttpClient, McpStdioClient } from '../src/mcp/index.js';

const clients: McpStdioClient[] = [];
afterEach(() => { for (const client of clients) client.close(); clients.length = 0; });

describe('MCP trust boundary', () => {
  test('discovers and calls only allowlisted tools over stdio', async () => {
    const client = new McpStdioClient('fixture', { command: process.execPath,
      args: [join(import.meta.dir, 'fixtures', 'mcp-server.ts')], trust: { enabled: true, allowTools: ['echo'] } }, 5_000);
    clients.push(client); await client.connect();
    expect((await client.listTools()).map(tool => tool.name)).toEqual(['echo', 'blocked']);
    expect(await client.callTool('echo', { value: 42 })).toEqual({ content: [{ type: 'text', text: '{"value":42}' }] });
    expect(client.callTool('blocked', {})).rejects.toThrow('not allowlisted');
  });

  test('refuses disabled servers before spawning', async () => {
    const client = new McpStdioClient('disabled', { command: 'never-run', trust: { enabled: false, allowTools: [] } });
    await expect(client.connect()).rejects.toThrow('disabled by trust policy');
  });
});

describe('MCP streamable HTTP', () => {
  test('uses bearer auth, session IDs, SSE decoding, and resource trust', async () => {
    process.env.TEST_MCP_TOKEN = 'secret-token';
    let sawSession = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer secret-token');
      if (headers.get('mcp-session-id') === 'session-1') sawSession = true;
      const body = JSON.parse(String(init?.body)) as any;
      const result = body.method === 'initialize' ? { protocolVersion: '2025-03-26' }
        : body.method === 'tools/list' ? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
        : body.method === 'resources/read' ? { contents: [{ uri: body.params.uri, text: 'safe data' }] } : {};
      return new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}

`, {
        headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'session-1' },
      });
    }) as typeof fetch;
    const client = new McpHttpClient('http-test', { transport: 'http', url: 'http://127.0.0.1/mcp',
      bearerTokenEnv: 'TEST_MCP_TOKEN', trust: { enabled: true, allowTools: ['echo'], allowResources: true } });
    try {
      await client.connect(); expect((await client.listTools())[0].name).toBe('echo');
      expect(await client.readResource('file:///safe')).toEqual({ contents: [{ uri: 'file:///safe', text: 'safe data' }] });
      expect(sawSession).toBe(true);
    } finally { globalThis.fetch = originalFetch; delete process.env.TEST_MCP_TOKEN; }
  });
});
