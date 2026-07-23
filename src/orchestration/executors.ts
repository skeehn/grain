import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import type { AgentPlugin, AgentResult, AgentTask as PluginTask } from '../plugins/types.js';
import type { AgentAuthority, AgentBudget, ExecutorKind, IsolationMode } from './types.js';

export interface ExecutorCapabilities {
  id: string;
  kind: ExecutorKind;
  installed: boolean;
  version?: string;
  streaming: boolean;
  steering: boolean;
  resume: boolean;
  nativeTools: boolean;
  images: boolean;
  sandboxing: boolean;
  usage: boolean;
  sessions: boolean;
  reason?: string;
}

export type ExecutorFailureCategory = 'configuration' | 'authentication' | 'provider' | 'protocol' | 'policy' | 'timeout' | 'cancelled' | 'verification';

export interface ExecutorRequest {
  objective: string;
  workdir: string;
  provider?: string;
  model?: string;
  sessionId?: string;
  context?: string[];
  skills?: string[];
  allowedTools?: string[];
  authority: AgentAuthority;
  isolation: IsolationMode;
  budget: AgentBudget;
}

export interface ExecutorUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
}

export interface ExecutorResult {
  success: boolean;
  summary: string;
  evidence: string[];
  changedPaths: string[];
  usage?: ExecutorUsage;
  externalSessionId?: string;
  failure?: { category: ExecutorFailureCategory; message: string; retryable: boolean };
  metadata?: Record<string, unknown>;
}

export type ExecutorEvent =
  | { type: 'started'; sessionId: string; executor: string; timestamp: string }
  | { type: 'status'; message: string; timestamp: string }
  | { type: 'completed'; result: ExecutorResult; timestamp: string };

export interface ExecutorSession {
  id: string;
  result: Promise<ExecutorResult>;
}

export interface ExecutorAdapter {
  readonly id: string;
  probe(): Promise<ExecutorCapabilities>;
  start(request: ExecutorRequest): Promise<ExecutorSession>;
  resume(sessionId: string, request: ExecutorRequest): Promise<ExecutorSession>;
  steer(sessionId: string, message: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  watch(sessionId: string): AsyncIterable<ExecutorEvent>;
}

class EventQueue implements AsyncIterable<ExecutorEvent> {
  private items: ExecutorEvent[] = [];
  private waiters: Array<(value: IteratorResult<ExecutorEvent>) => void> = [];
  private closed = false;
  push(event: ExecutorEvent): void { const waiter = this.waiters.shift(); waiter ? waiter({ value: event, done: false }) : this.items.push(event); }
  close(): void { this.closed = true; for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true }); }
  [Symbol.asyncIterator](): AsyncIterator<ExecutorEvent> { return { next: async () => {
    const item = this.items.shift(); if (item) return { value: item, done: false };
    if (this.closed) return { value: undefined, done: true };
    return new Promise(resolve => this.waiters.push(resolve));
  } }; }
}

function failureCategory(result: AgentResult): ExecutorFailureCategory {
  if (result.exitReason === 'timeout') return 'timeout';
  if (/auth|login|credential|api.?key/iu.test(result.output)) return 'authentication';
  if (/permission|sandbox|denied/iu.test(result.output)) return 'policy';
  return 'provider';
}

/** Compatibility bridge: existing CLI plugins gain the public executor contract. */
export class PluginExecutorAdapter implements ExecutorAdapter {
  readonly id: string;
  private sessions = new Map<string, { controller: AbortController; events: EventQueue; externalId?: string }>();
  constructor(private readonly plugin: AgentPlugin, private readonly kind: ExecutorKind) { this.id = plugin.name; }

  async probe(): Promise<ExecutorCapabilities> {
    const installed = await this.plugin.isInstalled();
    let version: string | undefined; let reason: string | undefined;
    if (installed) try { version = await this.plugin.getVersion(); } catch (error) { reason = error instanceof Error ? error.message : String(error); }
    const resumable = this.kind === 'claude-code' || this.kind === 'opencode' || this.kind === 'hermes';
    const usage = this.kind === 'claude-code' || this.kind === 'codex' || this.kind === 'opencode';
    return { id: this.id, kind: this.kind, installed, version, streaming: false, steering: false,
      resume: resumable, nativeTools: true, images: false, sandboxing: this.kind !== 'hermes', usage, sessions: resumable, reason };
  }

  async start(request: ExecutorRequest): Promise<ExecutorSession> { return this.launch(request); }
  async resume(sessionId: string, request: ExecutorRequest): Promise<ExecutorSession> { return this.launch({ ...request, sessionId }); }

  private async launch(request: ExecutorRequest): Promise<ExecutorSession> {
    const id = randomUUID(); const controller = new AbortController(); const events = new EventQueue();
    this.sessions.set(id, { controller, events });
    events.push({ type: 'started', sessionId: id, executor: this.id, timestamp: new Date().toISOString() });
    const task: PluginTask = { prompt: request.objective, workdir: request.workdir, context: request.context,
      provider: request.provider, model: request.model, skills: request.skills,
      mode: 'oneshot', sessionId: request.sessionId, signal: controller.signal,
      sandbox: request.authority.write ? 'workspace-write' : 'read-only', constraints: {
        maxTurns: request.budget.maxTurns, maxBudgetUSD: request.budget.maxCostUsd,
        allowedTools: request.allowedTools, timeoutSeconds: Math.ceil(request.budget.timeoutMs / 1000),
      } };
    const result = this.plugin.execute(task).then(raw => {
      const normalized: ExecutorResult = { success: raw.success, summary: raw.output,
        evidence: [`executor:${this.id}`, `exit:${raw.exitReason || (raw.success ? 'completed' : 'error')}`],
        changedPaths: raw.filesModified || [], externalSessionId: raw.sessionId,
        usage: { costUsd: raw.costUSD }, metadata: raw.metadata };
      if (!raw.success) normalized.failure = { category: failureCategory(raw), message: raw.output, retryable: raw.exitReason === 'timeout' };
      const state = this.sessions.get(id); if (state) state.externalId = raw.sessionId;
      events.push({ type: 'completed', result: normalized, timestamp: new Date().toISOString() }); events.close();
      return normalized;
    }).catch(error => {
      const normalized: ExecutorResult = { success: false, summary: String(error), evidence: [`executor:${this.id}`], changedPaths: [],
        failure: { category: controller.signal.aborted ? 'cancelled' : 'provider', message: String(error), retryable: false } };
      events.push({ type: 'completed', result: normalized, timestamp: new Date().toISOString() }); events.close(); return normalized;
    });
    return { id, result };
  }

  async steer(): Promise<void> { throw new Error(`${this.id} does not support live steering`); }
  async cancel(sessionId: string): Promise<void> { const session = this.sessions.get(sessionId); if (!session) throw new Error(`Unknown executor session ${sessionId}`); session.controller.abort(); }
  watch(sessionId: string): AsyncIterable<ExecutorEvent> { const session = this.sessions.get(sessionId); if (!session) throw new Error(`Unknown executor session ${sessionId}`); return session.events; }
}

export interface StdioExecutorCommand {
  binary: string;
  args?: string[];
  output: 'json' | 'jsonl' | 'text';
}

/**
 * Public, shell-free JSON/JSONL bridge for third-party agents.
 *
 * Grain writes one `grain-executor/v1` request to stdin. JSON adapters return
 * one result object; JSONL adapters may emit `{type:"status",message}` records
 * before a final `{type:"result",...ExecutorResult}` record. Plain text is
 * accepted as a chat-only result with no changed-path claims.
 */
export class StdioExecutorAdapter implements ExecutorAdapter {
  readonly id: string;
  private sessions = new Map<string, { controller: AbortController; events: EventQueue; child?: ReturnType<typeof spawn> }>();

  constructor(id: string, private readonly command: StdioExecutorCommand) { this.id = id; }

  async probe(): Promise<ExecutorCapabilities> {
    const installed = await new Promise<boolean>(resolve => {
      const child = spawn(this.command.binary, ['--version'], { stdio: 'ignore', shell: false });
      child.once('error', () => resolve(false)); child.once('close', code => resolve(code === 0));
    });
    return { id: this.id, kind: 'stdio', installed, streaming: this.command.output === 'jsonl', steering: false,
      resume: true, nativeTools: false, images: false, sandboxing: false, usage: this.command.output !== 'text', sessions: true,
      reason: installed ? undefined : `Could not execute ${this.command.binary}` };
  }

  async start(request: ExecutorRequest): Promise<ExecutorSession> { return this.launch(request); }
  async resume(sessionId: string, request: ExecutorRequest): Promise<ExecutorSession> { return this.launch({ ...request, sessionId }); }

  private async launch(request: ExecutorRequest): Promise<ExecutorSession> {
    const id = randomUUID(); const controller = new AbortController(); const events = new EventQueue();
    this.sessions.set(id, { controller, events });
    events.push({ type: 'started', sessionId: id, executor: this.id, timestamp: new Date().toISOString() });
    const result = new Promise<ExecutorResult>(resolve => {
      const child = spawn(this.command.binary, this.command.args || [], { cwd: request.workdir, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
      const state = this.sessions.get(id); if (state) state.child = child;
      let stdout = ''; let stderr = ''; let settled = false; let finalRecord: any; let timedOut = false;
      const finish = (normalized: ExecutorResult) => {
        if (settled) return; settled = true; clearTimeout(timeout);
        events.push({ type: 'completed', result: normalized, timestamp: new Date().toISOString() }); events.close(); resolve(normalized);
      };
      const cap = (current: string, chunk: Buffer) => (current + chunk.toString()).slice(-1_000_000);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout = cap(stdout, chunk);
        if (this.command.output === 'jsonl') {
          const lines = stdout.split(/\r?\n/u); stdout = lines.pop() || '';
          for (const line of lines) try {
            const record = JSON.parse(line);
            if (record.type === 'status' && typeof record.message === 'string') events.push({ type: 'status', message: record.message, timestamp: new Date().toISOString() });
            if (record.type === 'result') finalRecord = record.result || record;
          } catch { /* retained as protocol output; close reports malformed result */ }
        }
      });
      child.stderr.on('data', (chunk: Buffer) => { stderr = cap(stderr, chunk); });
      child.once('error', error => finish({ success: false, summary: String(error), evidence: [`executor:${this.id}`], changedPaths: [],
        failure: { category: 'configuration', message: String(error), retryable: false } }));
      child.once('close', code => {
        if (controller.signal.aborted) {
          const message = timedOut ? `Executor exceeded ${request.budget.timeoutMs}ms` : 'Executor cancelled';
          return finish({ success: false, summary: message, evidence: [`executor:${this.id}`], changedPaths: [],
            failure: { category: timedOut ? 'timeout' : 'cancelled', message, retryable: timedOut } });
        }
        try {
          const record = this.command.output === 'text' ? undefined : finalRecord || JSON.parse(stdout.trim());
          if (this.command.output === 'text') return finish({ success: code === 0, summary: stdout.trim() || stderr.trim(), evidence: [`executor:${this.id}`, `exit:${code}`], changedPaths: [],
            ...(code === 0 ? {} : { failure: { category: 'provider' as const, message: stderr.trim() || `Exited ${code}`, retryable: false } }) });
          if (!record || typeof record.success !== 'boolean' || typeof record.summary !== 'string') throw new Error('Final result must include boolean success and string summary');
          const normalized: ExecutorResult = { success: record.success, summary: record.summary,
            evidence: Array.isArray(record.evidence) ? record.evidence.map(String) : [`executor:${this.id}`, `exit:${code}`],
            changedPaths: Array.isArray(record.changedPaths) ? record.changedPaths.map(String) : [],
            usage: record.usage, externalSessionId: record.externalSessionId, metadata: record.metadata };
          if (!normalized.success) normalized.failure = record.failure || { category: 'provider', message: stderr.trim() || normalized.summary, retryable: false };
          finish(normalized);
        } catch (error) {
          finish({ success: false, summary: stderr.trim() || String(error), evidence: [`executor:${this.id}`, `exit:${code}`], changedPaths: [],
            failure: { category: 'protocol', message: String(error), retryable: false } });
        }
      });
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); child.kill('SIGTERM'); }, request.budget.timeoutMs);
      child.stdin.end(JSON.stringify({ protocol: 'grain-executor/v1', sessionId: request.sessionId, request }) + '\n');
    });
    return { id, result };
  }

  async steer(): Promise<void> { throw new Error(`${this.id} stdio protocol does not support live steering`); }
  async cancel(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId); if (!session) throw new Error(`Unknown executor session ${sessionId}`);
    session.controller.abort(); session.child?.kill('SIGTERM');
  }
  watch(sessionId: string): AsyncIterable<ExecutorEvent> { const session = this.sessions.get(sessionId); if (!session) throw new Error(`Unknown executor session ${sessionId}`); return session.events; }
}
