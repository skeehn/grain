import chalk from 'chalk';
import * as readline from 'readline';
import type { AgentMessage, TaskGraph } from '../orchestration/types.js';
import type { ContextManifest } from '../context/types.js';

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]] as const;
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const motion = process.stdout.isTTY && process.env.GRAIN_REDUCED_MOTION !== '1';
const tone = {
  grain: (s: string) => color ? chalk.hex('#D6A85F')(s) : s,
  leaf: (s: string) => color ? chalk.hex('#88A678')(s) : s,
  text: (s: string) => color ? chalk.hex('#E7E0D2')(s) : s,
  quiet: (s: string) => color ? chalk.hex('#817D73')(s) : s,
  danger: (s: string) => color ? chalk.hex('#E06C75')(s) : s,
  warning: (s: string) => color ? chalk.hex('#E5B567')(s) : s,
};

export interface SpinnerHandle { stop(): void }
let currentSpinner: SpinnerHandle | null = null;
const sink = () => process.env.GRAIN_MACHINE === '1' ? process.stderr : process.stdout;

export function orderedDither(width: number, phase = 0, level = 8): string {
  return Array.from({ length: width }, (_, x) => BAYER[phase % 4][x % 4] < level ? '█' : '░').join('');
}

export function banner(subtitle = 'coding agent · memory in the loop'): void {
  const width = Math.min(64, Math.max(36, (process.stdout.columns || 80) - 4));
  const line = '─'.repeat(width);
  sink().write(`\n${tone.grain(`╭${line}╮`)}\n`);
  sink().write(`${tone.grain('│')}  ${tone.grain('GRAIN')} ${tone.quiet('· repository workspace agent')}${' '.repeat(Math.max(1, width - 31))}${tone.grain('│')}\n`);
  sink().write(`${tone.grain('│')}  ${tone.quiet(subtitle.padEnd(width - 2).slice(0, width - 2))}${tone.grain('│')}\n`);
  sink().write(`${tone.grain(`╰${line}╯`)}\n\n`);
}

function stopCurrent(): void {
  currentSpinner?.stop();
  currentSpinner = null;
}

export function streamText(text: string): void { stopCurrent(); sink().write(tone.text(text)); }
export const stream = streamText;

export function toolStart(name: string, input: any): void {
  stopCurrent();
  const detail = input?._streaming ? 'running' : summarizeInput(name, input);
  sink().write(`\n${tone.grain('◆')} ${chalk.bold(name)} ${detail ? tone.quiet(`· ${detail}`) : ''}\n`);
}
export const tool = toolStart;

export function toolResult(output: string, isError = false): void {
  const max = Math.max(6, Math.min(18, Math.floor((process.stdout.rows || 30) * .45)));
  const lines = output.split('\n');
  const shown = lines.slice(0, max);
  if (lines.length > max) shown.push(`… ${lines.length - max} more lines`);
  const paint = isError ? tone.danger : tone.quiet;
  sink().write(shown.map(line => paint(`  ${line}`)).join('\n') + `\n${tone.grain(isError ? '×' : '·')} ${isError ? 'tool failed' : 'done'}\n`);
}
export function result(output: unknown, isError?: boolean): void {
  toolResult(typeof output === 'string' ? output : JSON.stringify(output, null, 2), isError);
}
export function success(message: string): void { sink().write(`${tone.leaf('◆')} ${message}\n`); }
export function newLine(): void { sink().write('\n'); }
export function clearLine(): void { if (process.stdout.isTTY) sink().write('\r\x1b[K'); }
export function warn(message: string): void { process.stderr.write(`${tone.warning('△')} ${message}\n`); }
export function error(message: string): void { process.stderr.write(`${tone.danger('×')} ${message}\n`); }
export function info(message: string): void { sink().write(`${tone.quiet('·')} ${message}\n`); }
export function dim(message: string): void { sink().write(`${tone.quiet(message)}\n`); }

const stateGlyph: Record<string, string> = {
  pending: '○', ready: '◇', running: '◈', waiting: '◌', succeeded: '◆', failed: '×', cancelled: '—', needs_reconciliation: '△',
};

export function formatAgentDashboard(graph: TaskGraph, messages: AgentMessage[] = []): string {
  const width = Math.max(48, Math.min(process.stdout.columns || 100, 120));
  const lines = [orderedDither(width, 1, 5), `AGENT GRAPH  ${graph.mode}  ${graph.id}`, orderedDither(width, 2, 2)];
  for (const task of graph.tasks) {
    const deps = task.dependencies.length ? ` ← ${task.dependencies.map(id => id.slice(0, 6)).join(',')}` : '';
    const lease = task.lease ? `  ${task.lease.owner} · heartbeat ${task.lease.heartbeatAt}` : '';
    lines.push(`${stateGlyph[task.state] || '?'} ${task.role.padEnd(11)} ${task.state.padEnd(20)} ${task.objective}${deps}${lease}`);
    if (task.lastError) lines.push(`  ! ${task.lastError}`);
  }
  const pending = messages.filter(message => !message.acknowledgedAt);
  lines.push(orderedDither(width, 3, 2), `MAILBOX  ${pending.length} pending / ${messages.length} total`);
  for (const message of pending.slice(-5)) lines.push(`◇ ${message.from} → ${message.to}  ${message.kind}`);
  return lines.join('\n');
}

export function agentDashboard(graph: TaskGraph, messages: AgentMessage[] = []): void {
  sink().write(`${formatAgentDashboard(graph, messages)}\n`);
}

export function formatContextBudget(manifest: ContextManifest): string {
  const used = manifest.estimatedInputTokens; const total = manifest.inputBudgetTokens;
  const cells = 24; const filled = Math.min(cells, Math.round((used / Math.max(1, total)) * cells));
  const bar = '█'.repeat(filled) + '░'.repeat(cells - filled);
  const kinds = new Map<string, number>();
  for (const item of manifest.selected) kinds.set(item.kind, (kinds.get(item.kind) || 0) + item.estimatedTokens);
  return [`CONTEXT  ${manifest.provider}/${manifest.model}`, `${bar} ${used}/${total} input tokens · ${manifest.reservedOutputTokens} reserved output`,
    ...[...kinds].map(([kind, tokens]) => `${kind.padEnd(14)} ${tokens}`), `tools          ${manifest.tools.join(', ') || 'none'}`].join('\n');
}

export function spinner(label = 'Thinking'): SpinnerHandle {
  stopCurrent();
  if (!process.stdout.isTTY) {
    sink().write(`${label.replace(/\.{1,3}$/, '')}…\n`);
    return currentSpinner = { stop() {} };
  }
  let frame = 0;
  let stopped = false;
  const render = () => sink().write(`\r\x1b[K${tone.grain(orderedDither(8, frame % 4, 4 + ((frame++ * 3) % 12)))}  ${tone.quiet(label)}`);
  render();
  const timer = motion ? setInterval(render, 110) : undefined;
  timer?.unref();
  const handle = currentSpinner = {
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      clearLine();
      if (currentSpinner === handle) currentSpinner = null;
    },
  };
  return handle;
}
export function stopSpinner(): void { stopCurrent(); }

export function userPrompt(promptText?: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    let answered = false;
    rl.question(promptText || `\n${tone.grain('◇')} `, answer => {
      answered = true;
      rl.close();
      resolve(answer);
    });
    rl.on('SIGINT', () => { rl.close(); reject(new Error('SIGINT')); });
    rl.on('close', () => { if (!answered) resolve(null); });
  });
}

function summarizeInput(name: string, input: any): string {
  if (!input || typeof input !== 'object') return '';
  const line = name === 'bash' ? input.command
    : name === 'write' ? `${input.path || ''} · ${Buffer.byteLength(input.content || '', 'utf8')} bytes`
    : name === 'grep' ? `/${input.pattern || ''}/ in ${input.path || '.'}`
    : name === 'engram' ? `${input.action || ''} ${input.query || input.body || ''}`
    : name === 'delegate' ? input.task
    : name === 'finish' ? (input.result || input.message)
    : input.path || JSON.stringify(input);
  const clean = String(line || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  const width = Math.max(30, Math.min(process.stdout.columns || 80, 120) - 8);
  return clean.length > width ? `${clean.slice(0, width - 1)}…` : clean;
}
