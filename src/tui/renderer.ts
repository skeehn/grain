import chalk from 'chalk';
import * as readline from 'readline';
import type { AgentMessage, TaskGraph } from '../orchestration/types.js';
import type { ContextManifest } from '../context/types.js';

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]] as const;
const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
] as const;
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const motion = process.stdout.isTTY && process.env.GRAIN_REDUCED_MOTION !== '1';
const tone = {
  grain: (s: string) => color ? chalk.hex('#D6A85F')(s) : s,
  leaf: (s: string) => color ? chalk.hex('#88A678')(s) : s,
  text: (s: string) => color ? chalk.hex('#E7E0D2')(s) : s,
  quiet: (s: string) => color ? chalk.hex('#817D73')(s) : s,
  danger: (s: string) => color ? chalk.hex('#E06C75')(s) : s,
  warning: (s: string) => color ? chalk.hex('#E5B567')(s) : s,
  ok: (s: string) => color ? chalk.hex('#88A678')(s) : s,   // success green
  run: (s: string) => color ? chalk.hex('#5F9BD6')(s) : s,  // running blue
};

export interface SpinnerHandle { stop(): void }
let currentSpinner: SpinnerHandle | null = null;
const sink = () => process.env.GRAIN_MACHINE === '1' ? process.stderr : process.stdout;

export function orderedDither(width: number, phase = 0, level = 8): string {
  return Array.from({ length: width }, (_, x) => BAYER[phase % 4][x % 4] < level ? '█' : '░').join('');
}

/** Render a horizontally scrolling 8×8 Bayer strip with a 0–64 density level. */
export function bayerDither(width: number, phase = 0, level = 32): string {
  const row = BAYER8[((phase % 8) + 8) % 8];
  const threshold = Math.max(0, Math.min(64, level));
  return Array.from({ length: width }, (_, x) => row[(x + Math.floor(phase / 8)) % 8] < threshold ? '█' : '░').join('');
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Tasteful animated launch banner: two Bayer-dither strips sweep and "resolve"
 * around the GRAIN wordmark, then settle. Skips the animation (prints the
 * settled frame once) when not a TTY or reduced-motion is set, so CI/pipes and
 * accessibility preferences are respected.
 */
export async function launchBanner(subtitle = 'repository agent · memory in the loop'): Promise<void> {
  const width = Math.min(48, Math.max(28, (process.stdout.columns || 80) - 4));
  const wordmark = `${tone.grain('▚ GRAIN')}  ${tone.quiet(subtitle)}`;
  const frame = (phase: number, level: number) =>
    `${tone.grain(bayerDither(width, phase, level))}\n${wordmark}\n${tone.grain(bayerDither(width, -phase, level))}\n`;

  if (!motion) { sink().write(`\n${frame(2, 10)}\n`); return; }

  sink().write('\n');
  // Sweep in (rising density) then out (falling) so it reads as a resolve.
  const steps = [2, 6, 12, 20, 30, 22, 14, 8, 5];
  for (let i = 0; i < steps.length; i++) {
    if (i > 0) sink().write('\x1b[3A'); // redraw the 3-line band in place
    sink().write(frame(i, steps[i]));
    await sleep(45);
  }
  sink().write('\n');
}

export function banner(subtitle = 'coding agent · memory in the loop'): void {
  const width = Math.min(64, Math.max(36, (process.stdout.columns || 80) - 4));
  const line = '─'.repeat(width);
  sink().write(`\n${tone.grain(`╭${line}╮`)}\n`);
  sink().write(`${tone.grain('│')}  ${tone.grain('GRAIN')} ${tone.quiet('· repository workspace agent')}${' '.repeat(Math.max(0, width - 36))}${tone.grain('│')}\n`);
  sink().write(`${tone.grain('│')}  ${tone.quiet(subtitle.padEnd(width - 2).slice(0, width - 2))}${tone.grain('│')}\n`);
  sink().write(`${tone.grain(`╰${line}╯`)}\n\n`);
}

function stopCurrent(): void {
  currentSpinner?.stop();
  currentSpinner = null;
}

export function streamText(text: string): void { stopCurrent(); sink().write(tone.text(text)); }
export const stream = streamText;

// Timing for the tool box footer — set on toolStart, read on toolResult.
let toolStartedAt = 0;

/** Human elapsed: 340 → "0.3s", 12_400 → "12.4s", 92_000 → "1m32s". */
function fmtElapsed(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m${Math.round((ms % 60_000) / 1000)}s`;
}

// Set true while a tool streams its output live so toolResult skips re-printing.
let streamedThisTool = false;
let streamedLines = 0;
const STREAM_LINE_CAP = 200; // keep a noisy command from scrolling the world away

export function toolStart(name: string, input: any): void {
  stopCurrent();
  toolStartedAt = Date.now();
  streamedThisTool = false;
  streamedLines = 0;
  const detail = input?._streaming ? '' : summarizeInput(name, input);
  // Blue left-bar header — the "running" state of the box.
  sink().write(`\n${tone.run('▌')} ${chalk.bold(name)}${detail ? ` ${tone.quiet(detail)}` : ''}\n`);
}
export const tool = toolStart;

/** Live output line from a running tool (e.g. bash) — printed inside the box
 *  as it arrives, so long builds/tests are watchable instead of a dead pause. */
export function streamToolLine(line: string): void {
  stopCurrent();
  streamedThisTool = true;
  if (streamedLines < STREAM_LINE_CAP) {
    sink().write(`${tone.quiet('▏')} ${tone.quiet(line)}\n`);
  } else if (streamedLines === STREAM_LINE_CAP) {
    sink().write(`${tone.quiet('▏')} ${tone.quiet('… streaming (further output folded; full result below)')}\n`);
  }
  streamedLines++;
}

export function toolResult(output: string, isError = false): void {
  const elapsed = toolStartedAt ? ` ${tone.quiet(fmtElapsed(Date.now() - toolStartedAt))}` : '';
  const footer = isError ? `${tone.danger('▙ ✗ failed')}${elapsed}` : `${tone.ok('▙ ✓ done')}${elapsed}`;
  // Output already streamed live — just close the box with the footer.
  if (streamedThisTool) {
    sink().write(`${footer}\n`);
    toolStartedAt = 0; streamedThisTool = false; streamedLines = 0;
    return;
  }
  const max = Math.max(8, Math.min(20, Math.floor((process.stdout.rows || 30) * .45)));
  const lines = output.replace(/\s+$/, '').split('\n');
  const shown = lines.slice(0, max);
  const bar = isError ? tone.danger : tone.ok;
  const body = shown.map(line => `${bar('▏')} ${tone.quiet(line)}`).join('\n');
  const hidden = lines.length > max ? `\n${bar('▏')} ${tone.quiet(`… ${lines.length - max} more line${lines.length - max === 1 ? '' : 's'}`)}` : '';
  sink().write(`${body}${hidden}\n${footer}\n`);
  toolStartedAt = 0;
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

/**
 * Pi-style status line: token/context/model, drawn as a full-width rule with a
 * dim caption. Shown just above the input prompt so it's always in view without
 * the complexity (and readline conflicts) of a scroll-region sticky bar.
 */
export function statusLine(text: string): void {
  if (!text) return;
  const width = Math.max(24, Math.min(process.stdout.columns || 80, 120));
  const caption = text.length > width - 2 ? `${text.slice(0, width - 3)}…` : text;
  sink().write(`${tone.quiet('─'.repeat(width))}\n${tone.quiet(caption)}\n`);
}

/** Retry countdown surfaced from a provider transient-error retry. */
export function retryNotice(attempt: number, max: number, seconds: number): void {
  sink().write(`${tone.warning('↻')} ${tone.quiet(`retrying (${attempt}/${max}) in ${seconds}s…`)}\n`);
}

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
  const render = () => {
    const level = 24 + Math.round((Math.sin(frame / 3) + 1) * 16);
    sink().write(`\r\x1b[K${tone.grain(bayerDither(12, frame++, level))}  ${tone.quiet(label)}`);
  };
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
