// Installed coding-agent CLIs as first-class Grain providers.
//
// `claude`, `codex`, and `opencode` are already signed in with the user's
// subscription. Spawning the installed binary is the only way to reach those
// models when the matching API key has no credit or does not exist — which is
// the normal case for subscription users. The child agent brings its own tools,
// so Grain streams its narration and treats the final message as the turn
// result instead of handing it Grain's tool schemas.
import { spawn, type ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { createHash } from 'crypto';
import type { Message, Provider, ProviderStreamOptions, StreamEvent, Tool } from './types.js';

export type CliAgentId = 'claude-code' | 'codex' | 'opencode' | 'grok';

export interface CliAgentDefinition {
  id: CliAgentId;
  binary: string;
  displayName: string;
  /** Model ids the CLI accepts directly; `auto` defers to the CLI's own default. */
  models: Array<{ id: string; label: string; hint: string }>;
  defaultModel: string;
  contextWindow: number;
}

export const CLI_AGENTS: Record<CliAgentId, CliAgentDefinition> = {
  'claude-code': {
    id: 'claude-code', binary: 'claude', displayName: 'Claude Code',
    defaultModel: 'auto', contextWindow: 200_000,
    models: [
      { id: 'auto', label: 'claude (default)', hint: 'subscription · whatever Claude Code is set to' },
      { id: 'opus', label: 'opus', hint: 'subscription · highest quality' },
      { id: 'sonnet', label: 'sonnet', hint: 'subscription · balanced' },
      { id: 'haiku', label: 'haiku', hint: 'subscription · fastest' },
    ],
  },
  codex: {
    id: 'codex', binary: 'codex', displayName: 'OpenAI Codex',
    defaultModel: 'auto', contextWindow: 272_000,
    models: [
      { id: 'auto', label: 'codex (default)', hint: 'subscription · whatever Codex is set to' },
      { id: 'gpt-5.6-terra', label: 'gpt-5.6-terra', hint: 'subscription · Codex default tier' },
    ],
  },
  opencode: {
    id: 'opencode', binary: 'opencode', displayName: 'OpenCode',
    defaultModel: 'auto', contextWindow: 200_000,
    models: [{ id: 'auto', label: 'opencode (default)', hint: 'local agent · uses its own configured model' }],
  },
  grok: {
    id: 'grok', binary: 'grok', displayName: 'Grok',
    defaultModel: 'auto', contextWindow: 256_000,
    models: [
      { id: 'auto', label: 'grok (default)', hint: 'subscription · Grok CLI / grokbot' },
      { id: 'grok-code', label: 'grok-code', hint: 'subscription · coding' },
    ],
  },
};

export function isCliAgentProvider(name: string): name is CliAgentId {
  return Object.prototype.hasOwnProperty.call(CLI_AGENTS, name);
}

// ─── Session continuity ───────────────────────────────────────────────────────
// Each CLI keeps its own conversation. Grain remembers the external session id
// per (agent, working directory) so a follow-up message continues the same
// thread instead of restarting cold — that is what makes these usable for
// day-to-day work rather than one-shot delegation.

interface SessionRecord { sessionId: string; updatedAt: string }

function sessionStorePath(): string {
  const home = process.env.GRAIN_HOME || join(homedir(), '.grain');
  mkdirSync(home, { recursive: true });
  return join(home, 'cli-agent-sessions.json');
}

function sessionKey(agent: string, cwd: string): string {
  return `${agent}:${createHash('sha256').update(cwd).digest('hex').slice(0, 16)}`;
}

function readSessions(): Record<string, SessionRecord> {
  try { return JSON.parse(readFileSync(sessionStorePath(), 'utf8')); } catch { return {}; }
}

export function rememberCliSession(agent: string, cwd: string, sessionId: string): void {
  const store = readSessions();
  store[sessionKey(agent, cwd)] = { sessionId, updatedAt: new Date().toISOString() };
  const path = sessionStorePath(); const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, path);
  } catch { /* session reuse is an optimisation, never a hard failure */ }
}

export function recallCliSession(agent: string, cwd: string): string | undefined {
  return readSessions()[sessionKey(agent, cwd)]?.sessionId;
}

export function forgetCliSession(agent: string, cwd: string): void {
  const store = readSessions(); delete store[sessionKey(agent, cwd)];
  const path = sessionStorePath(); const temp = `${path}.${process.pid}.tmp`;
  try { writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 }); renameSync(temp, path); } catch { /* advisory */ }
}

// ─── Prompt assembly ──────────────────────────────────────────────────────────

function blockText(message: Message): string {
  return message.content.map(block =>
    block.type === 'text' ? block.text
    : block.type === 'tool_result' ? `Tool result:\n${String(block.content ?? '')}`
    : block.type === 'tool_use' ? `Called ${block.name} ${JSON.stringify(block.input)}`
    : block.type === 'image' ? `[image: ${block.name || block.media_type}]`
    : '').filter(Boolean).join('\n\n');
}

/**
 * The child agent owns the conversation once a session exists, so a resumed
 * turn sends only the newest user message. A cold start replays the transcript
 * so switching models mid-conversation does not lose what came before.
 */
export function buildAgentPrompt(messages: Message[], resuming: boolean): string {
  const latest = [...messages].reverse().find(message => message.role === 'user');
  if (resuming) return latest ? blockText(latest) : '';
  const history = messages.slice(0, -1)
    .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${blockText(message)}`)
    .filter(line => line.length > 12);
  const current = latest ? blockText(latest) : '';
  if (!history.length) return current;
  return `Earlier conversation for context:\n\n${history.join('\n\n')}\n\n---\n\nCurrent request:\n${current}`;
}

/** Subscription credentials live in the CLI's own login, never in Grain's env. */
function subscriptionEnv(agent: CliAgentId): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', TERM: 'dumb', NO_COLOR: '1' };
  if (agent === 'claude-code') { delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; }
  return env;
}

/** argv for a child coding-agent CLI. Exported so tests can lock the flags. */
export function buildCliAgentArgv(
  name: CliAgentId,
  prompt: string,
  resumeId: string | undefined,
  options: { model?: string; write?: boolean } = {},
): string[] {
  const model = options.model && options.model !== 'auto' && options.model !== 'default' ? options.model : undefined;
  const write = options.write !== false;
  if (name === 'claude-code') {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
    if (model) args.push('--model', model);
    args.push('--permission-mode', write ? 'acceptEdits' : 'plan');
    if (resumeId) args.push('--resume', resumeId);
    return args;
  }
  if (name === 'codex') {
    const args = ['exec'];
    if (resumeId) args.push('resume', resumeId);
    args.push('--json', '--skip-git-repo-check', '--color', 'never');
    if (model) args.push('-m', model);
    args.push('-s', write ? 'workspace-write' : 'read-only');
    if (write) args.push('--approve-for-me');
    args.push(prompt);
    return args;
  }
  if (name === 'grok') {
    const args = ['-p', prompt, '--output-format', 'streaming-messages-json', '--include-partial-messages', '--no-subagents'];
    if (model) args.push('-m', model);
    args.push('--permission-mode', write ? 'acceptEdits' : 'plan');
    if (resumeId) args.push('--resume', resumeId);
    return args;
  }
  const args = ['run', '--format', 'json'];
  if (model) args.push('-m', model);
  if (resumeId) args.push('-s', resumeId);
  args.push(prompt);
  return args;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface StreamState { text: string; sessionId?: string; sawOutput: boolean }

export class CliAgentProvider implements Provider {
  readonly name: CliAgentId;
  readonly model: string;
  private readonly definition: CliAgentDefinition;

  constructor(
    agent: CliAgentId,
    model?: string,
    private readonly options: { cwd?: string; write?: boolean; fresh?: boolean } = {},
  ) {
    this.name = agent;
    this.definition = CLI_AGENTS[agent];
    this.model = model && model !== 'default' ? model : this.definition.defaultModel;
  }

  private argv(prompt: string, resumeId: string | undefined, write: boolean): string[] {
    return buildCliAgentArgv(this.name, prompt, resumeId, { model: this.model, write });
  }

  /** Translate one CLI event into stream events. Narration keeps the outer
   *  inactivity watchdog fed while the child agent runs long tools. */
  private *translate(record: any, state: StreamState): Generator<StreamEvent> {
    if (!record || typeof record !== 'object') return;

    if (this.name === 'claude-code' || this.name === 'grok') {
      if (record.session_id || record.sessionId) state.sessionId = record.session_id || record.sessionId;
      if (record.type === 'system' && record.session_id) state.sessionId = record.session_id;
      if (record.type === 'stream_event') {
        const delta = record.event?.delta;
        if (delta?.type === 'text_delta' && delta.text) { state.text += delta.text; state.sawOutput = true; yield { type: 'text_delta', text: delta.text }; }
        return;
      }
      if (record.type === 'content_block_delta') {
        const text = typeof record.delta?.text === 'string' ? record.delta.text
          : record.delta?.type === 'text_delta' && typeof record.delta?.text === 'string' ? record.delta.text : '';
        if (text) { state.text += text; state.sawOutput = true; yield { type: 'text_delta', text }; }
        return;
      }
      if (record.type === 'assistant') {
        for (const block of record.message?.content || []) {
          if (block.type === 'text' && block.text && !state.sawOutput) {
            state.text += block.text; state.sawOutput = true; yield { type: 'text_delta', text: block.text };
          }
          if (block.type === 'tool_use') yield { type: 'text_delta', text: `\n· ${block.name}${toolHint(block.input)}\n` };
        }
        return;
      }
      if (record.type === 'result' || record.type === 'message_stop') {
        if (record.session_id) state.sessionId = record.session_id;
        if (!state.sawOutput && record.result) yield { type: 'text_delta', text: String(record.result) };
        const usage = record.usage || {};
        if (usage.input_tokens || usage.output_tokens || record.total_cost_usd) {
          yield { type: 'usage', input_tokens: (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0),
            output_tokens: usage.output_tokens || 0, cache_read_tokens: usage.cache_read_input_tokens,
            cost_usd: record.total_cost_usd };
        }
        if (record.is_error) yield { type: 'error', error: String(record.result || `${this.definition.displayName} reported an error`) };
      }
      return;
    }

    if (this.name === 'codex') {
      const message = record.msg || record;
      if (record.session_id || message.session_id) state.sessionId = record.session_id || message.session_id;
      if (message.type === 'session_configured' && message.session_id) state.sessionId = message.session_id;
      if (message.type === 'agent_message_delta' && message.delta) { state.text += message.delta; state.sawOutput = true; yield { type: 'text_delta', text: message.delta }; }
      else if (message.type === 'agent_message' && !state.sawOutput && message.message) { state.sawOutput = true; yield { type: 'text_delta', text: String(message.message) }; }
      else if (message.type === 'agent_reasoning_delta' && (message.delta || message.text)) {
        yield { type: 'reasoning_delta', text: String(message.delta || message.text) };
      } else if (message.type === 'agent_reasoning' && (message.text || message.message)) {
        yield { type: 'reasoning_delta', text: String(message.text || message.message) };
      } else if (message.type === 'exec_command_begin') {
        state.sawOutput = true;
        yield { type: 'text_delta', text: `\n· ${Array.isArray(message.command) ? message.command.join(' ') : message.command}\n` };
      } else if (message.type === 'token_count' && message.info) {
        yield { type: 'usage', input_tokens: message.info.total_token_usage?.input_tokens || 0,
          output_tokens: message.info.total_token_usage?.output_tokens || 0 };
      } else if (message.type === 'error') yield { type: 'error', error: String(message.message || 'Codex reported an error') };
      return;
    }

    // opencode: emits loosely-shaped session/message events.
    if (record.sessionID || record.sessionId) state.sessionId = record.sessionID || record.sessionId;
    const text = record.part?.text ?? record.text ?? record.properties?.part?.text;
    if (typeof text === 'string' && text) { state.text += text; state.sawOutput = true; yield { type: 'text_delta', text }; }
  }

  async *stream(messages: Message[], system: string, _tools: Tool[], options?: ProviderStreamOptions): AsyncIterable<StreamEvent> {
    const cwd = this.options.cwd || process.cwd();
    const atHome = resolve(cwd) === resolve(homedir());
    const write = this.options.write !== false && !atHome;
    const resumeId = this.options.fresh ? undefined : recallCliSession(this.name, cwd);
    let prompt = buildAgentPrompt(messages, Boolean(resumeId));
    if (atHome && prompt.trim()) {
      prompt = `General chat — this is not a code repository. Answer the user directly. Do not scan, list, or search ${cwd}.\n\n${prompt}`;
    }
    if (!prompt.trim()) { yield { type: 'message_end', stop_reason: 'end_turn' }; return; }

    const args = this.argv(prompt, resumeId, write);
    // A cold Claude Code session accepts Grain's project instructions; a resumed
    // one already carries them, and re-sending would duplicate every turn.
    if (this.name === 'claude-code' && !resumeId && system.trim()) {
      args.push('--append-system-prompt', system.slice(0, 8_000));
    }
    if (this.name === 'grok' && !resumeId && system.trim()) {
      args.push('--rules', system.slice(0, 8_000));
    }

    yield { type: 'text_delta', text: `Starting ${this.definition.displayName}…\n` };

    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(this.definition.binary, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: subscriptionEnv(this.name) });
    } catch (error) {
      yield { type: 'error', error: `Could not start ${this.definition.binary}: ${error instanceof Error ? error.message : String(error)}` };
      return;
    }

    const state: StreamState = { text: '', sawOutput: false };
    const startedAt = Date.now();
    const FIRST_BYTE_MS = 45_000;
    const queue: StreamEvent[] = [];
    let done = false; let failure: string | undefined; let stderr = '';
    let wake: (() => void) | undefined;
    const push = (event: StreamEvent) => { queue.push(event); wake?.(); wake = undefined; };
    const finish = () => { done = true; wake?.(); wake = undefined; };

    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let record: any;
        try { record = JSON.parse(line); } catch { continue; }
        for (const event of this.translate(record, state)) push(event);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4_000); });
    child.on('error', error => { failure = `${this.definition.binary}: ${error.message}`; finish(); });
    child.on('close', code => {
      if (code !== 0 && !state.sawOutput) failure = cliFailureMessage(this.name, stderr, code);
      finish();
    });

    const abort = () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } };
    options?.signal?.addEventListener('abort', abort, { once: true });

    try {
      while (!done || queue.length) {
        // Usage-only events must not postpone the first-byte watchdog — Codex
        // can emit token_count forever while the TUI looks frozen on "hi".
        if (!state.sawOutput && Date.now() - startedAt > FIRST_BYTE_MS) {
          failure = `${this.definition.displayName} produced no output in ${Math.round(FIRST_BYTE_MS / 1000)}s.`
            + (stderr.trim() ? `\n${stderr.trim()}` : ` Is ${this.definition.binary} installed and logged in?`);
          abort();
          break;
        }
        if (!queue.length) {
          await new Promise<void>(resolve => { wake = resolve; setTimeout(resolve, 250); });
          continue;
        }
        const event = queue.shift()!;
        if (event.type === 'text_delta' || event.type === 'reasoning_delta' || event.type === 'error') state.sawOutput = true;
        yield event;
      }
      if (state.sessionId) rememberCliSession(this.name, cwd, state.sessionId);
      if (failure) { yield { type: 'error', error: failure }; return; }
      yield { type: 'message_end', stop_reason: 'end_turn' };
    } finally {
      options?.signal?.removeEventListener('abort', abort);
      if (child.exitCode === null) abort();
    }
  }
}

function toolHint(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  const value = record.command ?? record.file_path ?? record.path ?? record.pattern ?? record.description;
  return value ? `(${String(value).replace(/\s+/gu, ' ').slice(0, 60)})` : '';
}

/** Turn a child CLI failure into something the user can act on. */
export function cliFailureMessage(agent: CliAgentId, stderr: string, code: number | null): string {
  const binary = CLI_AGENTS[agent].binary;
  const detail = stderr.trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 400);
  if (/usage limit|rate.?limit|quota/iu.test(detail)) return `${binary} hit its subscription usage limit. ${detail}`;
  if (/not logged in|login|unauthorized|authenticate/iu.test(detail)) return `${binary} is not signed in. Run \`${binary}\` once to log in, then retry.`;
  if (/ENOENT|command not found/iu.test(detail)) return `${binary} is not installed or not on PATH.`;
  return detail || `${binary} exited with code ${code}`;
}
