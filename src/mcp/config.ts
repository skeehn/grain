import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { McpConfig } from './types.js';

export function mcpConfigPath(): string { return join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'mcp.json'); }
export function loadMcpConfig(): McpConfig {
  if (!existsSync(mcpConfigPath())) return { servers: {} };
  const parsed = JSON.parse(readFileSync(mcpConfigPath(), 'utf8')) as McpConfig;
  if (!parsed || !parsed.servers || typeof parsed.servers !== 'object' || Array.isArray(parsed.servers)) throw new Error('Invalid MCP config: servers object is required');
  for (const [name, server] of Object.entries(parsed.servers)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid MCP server configuration: ${name}`);
    const invalid = (field: string): never => { throw new Error(`Invalid MCP server ${name}: ${field}. Check ${mcpConfigPath()}`); };
    if (!server || typeof server !== 'object' || Array.isArray(server)) invalid('expected a server object');
    const transport = server.transport || (server.url ? 'http' : 'stdio');
    if (!['stdio', 'http'].includes(transport)) invalid('transport must be stdio or http');
    if (transport === 'stdio' && (typeof server.command !== 'string' || !server.command.trim())) throw new Error(`MCP stdio server ${name} requires command`);
    const stringArray = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string');
    if (server.args !== undefined && !stringArray(server.args)) invalid('args must be an array of strings');
    for (const field of ['cwd', 'bearerTokenEnv'] as const) if (server[field] !== undefined && typeof server[field] !== 'string') invalid(`${field} must be a string`);
    for (const field of ['env', 'headers'] as const) {
      const value = server[field];
      if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(item => typeof item !== 'string'))) invalid(`${field} must map names to strings`);
    }
    if (transport === 'http') {
      if (typeof server.url !== 'string' || !server.url) throw new Error(`MCP HTTP server ${name} requires url`);
      let urlObj: URL;
      try { urlObj = new URL(server.url); }
      catch { throw new Error(`MCP HTTP server ${name} has invalid url`); }
      if (urlObj.protocol !== 'https:' && !(urlObj.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(urlObj.hostname))) throw new Error(`MCP HTTP server ${name} must use HTTPS or loopback (HTTP only)`);
    }
    server.transport = transport;

    // Ensure a well-formed trust object and default allowTools to an empty array
    if (server.trust === undefined) server.trust = { enabled: false, allowTools: [] };
    if (!server.trust || typeof server.trust !== 'object' || Array.isArray(server.trust)) invalid('trust must be an object');
    for (const field of ['enabled', 'allowResources', 'allowPrompts'] as const) if (server.trust[field] !== undefined && typeof server.trust[field] !== 'boolean') invalid(`trust.${field} must be boolean`);
    if (server.trust.allowTools !== undefined && !stringArray(server.trust.allowTools)) invalid('trust.allowTools must be an array of tool names');
    if (server.trust.inheritEnv !== undefined && !stringArray(server.trust.inheritEnv)) invalid('trust.inheritEnv must be an array of environment names');
    server.trust.enabled ??= false;
    server.trust.allowTools ??= [];
  }
  return parsed;
}
