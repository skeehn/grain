import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { McpPrompt, McpResource, McpServerConfig, McpTool } from './types.js';

interface Pending { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; }

export class McpStdioClient {
  private process?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  constructor(readonly name: string, private readonly config: McpServerConfig, private readonly timeoutMs = 30_000) {}

  async connect(): Promise<void> {
    if (!this.config.trust.enabled) throw new Error(`MCP server ${this.name} is disabled by trust policy`);
    const inherited: Record<string, string> = {};
    for (const key of this.config.trust.inheritEnv || ['PATH', 'HOME']) if (process.env[key]) inherited[key] = process.env[key]!;
    this.process = spawn(this.config.command!, this.config.args || [], {
      cwd: this.config.cwd, env: { ...inherited, ...this.config.env }, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
    });
    this.process.stdout.setEncoding('utf8'); this.process.stdout.on('data', chunk => this.consume(chunk));
    this.process.on('exit', (code, signal) => this.failAll(new Error(`MCP server ${this.name} exited (${code ?? signal})`)));
    this.process.on('error', error => this.failAll(error));
    await this.request('initialize', { protocolVersion: '2025-03-26', capabilities: {},
      clientInfo: { name: 'grain', version: '0.2.0' } });
    this.notify('notifications/initialized', {});
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf('\n'); if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim(); this.buffer = this.buffer.slice(newline + 1); if (!line) continue;
      let message: any; try { message = JSON.parse(line); } catch { this.failAll(new Error(`MCP server ${this.name} emitted malformed JSON`)); return; }
      if (typeof message.id !== 'number') continue;
      const pending = this.pending.get(message.id); if (!pending) continue;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`MCP ${message.error.code}: ${message.error.message}`)); else pending.resolve(message.result);
    }
  }

  private failAll(error: Error): void { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); }
  private write(message: unknown): void { if (!this.process?.stdin.writable) throw new Error(`MCP server ${this.name} is not connected`); this.process.stdin.write(`${JSON.stringify(message)}\n`); }
  private notify(method: string, params: unknown): void { this.write({ jsonrpc: '2.0', method, params }); }

  request(method: string, params: unknown, signal?: AbortSignal): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP ${method} timed out after ${this.timeoutMs}ms`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const abort = () => { const pending = this.pending.get(id); if (!pending) return; clearTimeout(pending.timer); this.pending.delete(id);
        this.notify('notifications/cancelled', { requestId: id, reason: 'cancelled by Grain' }); reject(new Error(`MCP ${method} cancelled`)); };
      signal?.addEventListener('abort', abort, { once: true });
      try { this.write({ jsonrpc: '2.0', id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async listTools(): Promise<McpTool[]> { return (await this.request('tools/list', {})).tools || []; }
  async listResources(): Promise<McpResource[]> { if (!this.config.trust.allowResources) return []; return (await this.request('resources/list', {})).resources || []; }
  async listPrompts(): Promise<McpPrompt[]> { if (!this.config.trust.allowPrompts) return []; return (await this.request('prompts/list', {})).prompts || []; }
  async readResource(uri: string, signal?: AbortSignal): Promise<unknown> {
    if (!this.config.trust.allowResources) throw new Error(`MCP resources are not trusted for ${this.name}`);
    return this.request('resources/read', { uri }, signal);
  }
  async getPrompt(name: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!this.config.trust.allowPrompts) throw new Error(`MCP prompts are not trusted for ${this.name}`);
    return this.request('prompts/get', { name, arguments: args }, signal);
  }
  async callTool(name: string, args: unknown, signal?: AbortSignal): Promise<any> {
    if (!this.config.trust.allowTools.includes(name)) throw new Error(`MCP tool ${this.name}/${name} is not allowlisted`);
    return this.request('tools/call', { name, arguments: args }, signal);
  }
  close(): void { this.process?.kill('SIGTERM'); this.process = undefined; }
}
