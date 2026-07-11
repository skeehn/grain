import type { McpClient, McpPrompt, McpResource, McpServerConfig, McpTool } from './types.js';

export class McpHttpClient implements McpClient {
  private nextId = 1;
  private sessionId?: string;
  constructor(readonly name: string, private readonly config: McpServerConfig, private readonly timeoutMs = 30_000) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...this.config.headers };
    if (this.config.bearerTokenEnv) {
      const token = process.env[this.config.bearerTokenEnv];
      if (!token) throw new Error(`MCP bearer token environment variable ${this.config.bearerTokenEnv} is not set`);
      headers.Authorization = `Bearer ${token}`;
    }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    return headers;
  }

  private async decode(response: Response): Promise<any> {
    const text = await response.text();
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 2_000)}`);
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const payloads = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).filter(Boolean);
      if (!payloads.length) throw new Error('MCP HTTP stream contained no data event');
      return JSON.parse(payloads[payloads.length - 1]);
    }
    return JSON.parse(text);
  }

  async request(method: string, params: unknown, signal?: AbortSignal): Promise<any> {
    if (!this.config.trust.enabled) throw new Error(`MCP server ${this.name} is disabled by trust policy`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(this.config.url!, { method: 'POST', headers: this.headers(),
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }), signal: controller.signal });
      this.sessionId ||= response.headers.get('mcp-session-id') || undefined;
      const message = await this.decode(response);
      if (message.error) throw new Error(`MCP ${message.error.code}: ${message.error.message}`);
      return message.result;
    } catch (error: any) {
      if (error?.name === 'AbortError') throw new Error(signal?.aborted ? `MCP ${method} cancelled` : `MCP ${method} timed out after ${this.timeoutMs}ms`);
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }

  async connect(): Promise<void> { await this.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'grain', version: '0.2.0' } }); }
  async listTools(): Promise<McpTool[]> { return (await this.request('tools/list', {})).tools || []; }
  async listResources(): Promise<McpResource[]> { if (!this.config.trust.allowResources) return []; return (await this.request('resources/list', {})).resources || []; }
  async listPrompts(): Promise<McpPrompt[]> { if (!this.config.trust.allowPrompts) return []; return (await this.request('prompts/list', {})).prompts || []; }
  async readResource(uri: string, signal?: AbortSignal): Promise<unknown> { if (!this.config.trust.allowResources) throw new Error(`MCP resources are not trusted for ${this.name}`); return this.request('resources/read', { uri }, signal); }
  async getPrompt(name: string, args: unknown, signal?: AbortSignal): Promise<unknown> { if (!this.config.trust.allowPrompts) throw new Error(`MCP prompts are not trusted for ${this.name}`); return this.request('prompts/get', { name, arguments: args }, signal); }
  async callTool(name: string, args: unknown, signal?: AbortSignal): Promise<unknown> { if (!this.config.trust.allowTools.includes(name)) throw new Error(`MCP tool ${this.name}/${name} is not allowlisted`); return this.request('tools/call', { name, arguments: args }, signal); }
  async close(): Promise<void> { if (!this.sessionId) return; try { await fetch(this.config.url!, { method: 'DELETE', headers: this.headers() }); } finally { this.sessionId = undefined; } }
}
