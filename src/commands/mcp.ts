import { loadMcpConfig, mcpConfigPath } from '../mcp/config.js';
import { McpStdioClient } from '../mcp/client.js';
import { McpHttpClient } from '../mcp/http-client.js';

export async function handleMcpCommand(subcommand = 'list', name?: string): Promise<void> {
  if (!['list', 'validate', 'tools'].includes(subcommand)) throw new Error(`Unknown MCP command: ${subcommand}. Run grain mcp --help.`);
  const config = loadMcpConfig();
  if (subcommand === 'validate') {
    console.log(`Valid MCP configuration: ${Object.keys(config.servers).length} server(s). ${mcpConfigPath()}`); return;
  }
  if (subcommand === 'list') {
    console.log(`MCP configuration: ${mcpConfigPath()}`);
    if (!Object.keys(config.servers).length) console.log('No servers configured. Run grain mcp --help for setup.');
    for (const [id, server] of Object.entries(config.servers)) {
      console.log(`${id}\t${server.transport}\t${server.trust.enabled ? 'enabled' : 'disabled'}\t${server.trust.allowTools.length} allowed tool(s)`);
    }
    return;
  }
  if (!name) throw new Error('Usage: grain mcp tools SERVER');
  const server = config.servers[name];
  if (!server) throw new Error(`Unknown MCP server: ${name}. Run grain mcp list.`);
  const client = server.transport === 'http' ? new McpHttpClient(name, server) : new McpStdioClient(name, server);
  try {
    await client.connect();
    for (const tool of await client.listTools()) console.log(`${tool.name}\t${server.trust.allowTools.includes(tool.name) ? 'allowed' : 'blocked'}`);
  } finally { await client.close(); }
}
