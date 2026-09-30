import { test, expect } from 'bun:test';
import { McpHttpClient } from '../src/mcp/http-client.js';

test('HTTP MCP initializes a session, matches SSE responses, and closes it', async () => {
  let ready = false; let deleted = false;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    if (req.method === 'DELETE') { deleted = true; return new Response(null, { status: 204 }); }
    const body = await req.json() as any;
    if (body.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } } }, { headers: { 'mcp-session-id': 'test-session' } });
    if (req.headers.get('mcp-session-id') !== 'test-session') return new Response('session missing', { status: 400 });
    if (body.method === 'notifications/initialized') { ready = true; return new Response(null, { status: 202 }); }
    if (!ready) return new Response('initialization notification missing', { status: 400 });
    // The request's response is not necessarily the last event on a stream.
    const response = { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } };
    return new Response(`data: ${JSON.stringify(response)}\n\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  } });
  const client = new McpHttpClient('http', { url: `http://127.0.0.1:${server.port}/mcp`, trust: { enabled: true, allowTools: ['echo'] } }, 1000);
  try { await client.connect(); expect((await client.listTools())[0].name).toBe('echo'); await client.close(); expect(deleted).toBe(true); }
  finally { server.stop(true); }
});
