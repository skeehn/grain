import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { McpConfig } from './types.js';

export function mcpConfigPath(): string { return join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'mcp.json'); }
export function loadMcpConfig(): McpConfig {
  if (!existsSync(mcpConfigPath())) return { servers: {} };
  const parsed = JSON.parse(readFileSync(mcpConfigPath(), 'utf8')) as McpConfig;
  if (!parsed.servers || typeof parsed.servers !== 'object') throw new Error('Invalid MCP config: servers object is required');
  for (const [name, server] of Object.entries(parsed.servers)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid MCP server configuration: ${name}`);
    const transport = server.transport || (server.url ? 'http' : 'stdio');
    if (transport === 'stdio' && !server.command) throw new Error(`MCP stdio server ${name} requires command`);
    if (transport === 'http') {
      if (!server.url) throw new Error(`MCP HTTP server ${name} requires url`);
      let urlObj: URL;
      try { urlObj = new URL(server.url); }
      catch { throw new Error(`MCP HTTP server ${name} has invalid url`); }
      if (urlObj.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(urlObj.hostname)) throw new Error(`MCP HTTP server ${name} must use HTTPS or loopback`);
    }
    server.transport = transport;

    // Ensure a well-formed trust object and default allowTools to an empty array
    if (!server.trust || typeof server.trust !== 'object') server.trust = { allowTools: [] } as any;
    (server.trust as any).allowTools = (server.trust as any).allowTools || [];
  }
  return parsed;
}
