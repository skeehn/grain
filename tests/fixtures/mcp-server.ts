import * as readline from 'readline';

const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result: unknown = {};
  if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
  if (message.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'echo input', inputSchema: { type: 'object' } },
    { name: 'blocked', inputSchema: { type: 'object' } }] };
  if (message.method === 'tools/call') result = { content: [{ type: 'text', text: JSON.stringify(message.params.arguments) }] };
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
});
