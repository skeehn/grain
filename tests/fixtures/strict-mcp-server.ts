import * as readline from 'readline';

const allowedKeys = new Set(['jsonrpc', 'id', 'method', 'params']);
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const extra = Object.keys(message).filter(key => !allowedKeys.has(key));
  if (extra.length) return;
  const result = message.method === 'initialize'
    ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'strict-fixture', version: '1' } }
    : message.method === 'tools/list' ? { tools: [] } : {};
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
});
