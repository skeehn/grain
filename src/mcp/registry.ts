import type { Tool, ToolResult } from '../providers/types.js';
import { loadMcpConfig } from './config.js';
import { McpStdioClient } from './client.js';
import { McpHttpClient } from './http-client.js';
import type { McpClient } from './types.js';

const clients = new Map<string, McpClient>();

export async function discoverMcpTools(): Promise<Array<{ tool: Tool; execute(input: unknown): Promise<ToolResult> }>> {
  const config = loadMcpConfig(); const discovered: Array<{ tool: Tool; execute(input: unknown): Promise<ToolResult> }> = [];
  for (const [serverName, server] of Object.entries(config.servers)) {
    if (!server.trust.enabled) continue;
    const client: McpClient = server.transport === 'http' ? new McpHttpClient(serverName, server) : new McpStdioClient(serverName, server);
    await client.connect(); clients.set(serverName, client);
    for (const remote of await client.listTools()) {
      if (!server.trust.allowTools.includes(remote.name)) continue;
      const name = `mcp__${serverName}__${remote.name}`;
      discovered.push({ tool: { name, description: `[Untrusted MCP ${serverName}] ${remote.description || remote.name}`,
        input_schema: remote.inputSchema || { type: 'object' } },
        execute: async input => { try { return { content: JSON.stringify(await client.callTool(remote.name, input)) }; }
          catch (error: any) { return { content: error.message, is_error: true }; } } });
    }
    if (server.trust.allowResources) discovered.push({ tool: {
      name: `mcp__${serverName}__resource_read`, description: `[Untrusted MCP ${serverName}] Read an explicitly addressed resource`,
      input_schema: { type: 'object', properties: { uri: { type: 'string' } }, required: ['uri'] },
    }, execute: async input => { try { return { content: JSON.stringify(await client.readResource(String((input as any)?.uri || ''))) }; }
      catch (error: any) { return { content: error.message, is_error: true }; } } });
    if (server.trust.allowPrompts) discovered.push({ tool: {
      name: `mcp__${serverName}__prompt_get`, description: `[Untrusted MCP ${serverName}] Fetch a trusted-server prompt as untrusted context`,
      input_schema: { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object' } }, required: ['name'] },
    }, execute: async input => { try { return { content: JSON.stringify(await client.getPrompt(String((input as any)?.name || ''), (input as any)?.arguments || {})) }; }
      catch (error: any) { return { content: error.message, is_error: true }; } } });
  }
  return discovered;
}

export function closeMcpClients(): void { for (const client of clients.values()) void client.close(); clients.clear(); }
