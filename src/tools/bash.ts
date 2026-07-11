import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as readline from 'readline';
import type { ToolResult } from '../providers/types.js';

// ── Terminal-Bench bridge mode ─────────────────────────────────────────────────
// When GRAIN_TB_BRIDGE=1, bash commands are proxied to the host via JSON-line
// protocol over stdout/stdin instead of running locally.
// The TerminalBench grain agent reads these messages and executes them in the
// Docker container via TmuxSession, then writes back the result.

const isBridge = () => process.env.GRAIN_TB_BRIDGE === '1';

// readline interface for reading bridge responses
let _rl: readline.Interface | null = null;
let _pendingResolve: ((line: string) => void) | null = null;

function getBridgeRL(): readline.Interface {
  if (!_rl) {
    _rl = readline.createInterface({ input: process.stdin, terminal: false });
    _rl.on('line', (line) => {
      if (_pendingResolve) {
        const fn = _pendingResolve;
        _pendingResolve = null;
        fn(line);
      }
    });
  }
  return _rl;
}

function readBridgeLine(): Promise<string> {
  getBridgeRL(); // ensure listener is set up
  return new Promise((resolve) => {
    _pendingResolve = resolve;
  });
}

async function executeBashBridge(
  command: string,
  timeoutMs: number,
): Promise<{ output: string; exitCode: number }> {
  // Write request to stdout (the TB agent reads this)
  const req = JSON.stringify({ type: 'bash', cmd: command });
  process.stdout.write(req + '\n');

  // Wait for response with timeout
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('bridge timeout')), timeoutMs)
  );

  try {
    const line = await Promise.race([readBridgeLine(), timeoutPromise]);
    const resp = JSON.parse(line);
    return {
      output: resp.output ?? '(no output)',
      exitCode: resp.exit_code ?? 0,
    };
  } catch {
    return { output: '[bridge timeout or error]', exitCode: 124 };
  }
}

const MAX_OUTPUT = 50_000;
const DEFAULT_TIMEOUT = 60_000;

// ── Persistent shell session ───────────────────────────────────────────────────

interface ShellSession {
  proc: ChildProcessWithoutNullStreams;
  cwd: string;
}

let _session: ShellSession | null = null;

function getOrCreateShell(cwd: string): ShellSession {
  if (_session && !_session.proc.killed) return _session;
  const proc = spawn('bash', ['--norc', '--noprofile'], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PS1: '', TERM: 'dumb' },
  });
  proc.on('exit', () => { _session = null; });
  _session = { proc, cwd };
  return _session;
}

export function destroyShell(): void {
  if (_session) {
    try { _session.proc.stdin.end(); } catch {}
    try { _session.proc.kill(); } catch {}
    _session = null;
  }
}

// ── Command execution inside persistent shell ──────────────────────────────────

function runInShell(
  session: ShellSession,
  command: string,
  timeoutMs: number,
  onLine: (line: string) => void,
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    const sentinel = `__GRAIN_DONE_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    let output = '';
    let done = false;
    let lineBuffer = '';  // accumulates partial lines across chunks

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        cleanup();
        try { session.proc.stdin.write('\x03\n'); } catch {}
        resolve({ output: output + '\n[timeout]', exitCode: 124 });
      }
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      session.proc.stdout.off('data', onData);
      session.proc.stderr.off('data', onErrData);
    }

    function processLine(line: string) {
      if (done) return;
      // Check sentinel — must be exact match on the line
      if (line.startsWith(sentinel + ':') || line === sentinel) {
        const exitCodeStr = line.includes(':') ? line.split(':').pop()?.trim() ?? '0' : '0';
        done = true;
        cleanup();
        resolve({ output: output.trim(), exitCode: parseInt(exitCodeStr, 10) || 0 });
        return;
      }
      output += line + '\n'; // preserve blank lines (sentinel already handled above)
      if (output.length > MAX_OUTPUT && !output.includes('[output truncated')) {
        output = output.slice(0, MAX_OUTPUT) + '\n... [output truncated at 50KB]';
      }
      if (output.length < MAX_OUTPUT) onLine(line);
    }

    const onData = (chunk: Buffer) => {
      // Accumulate into lineBuffer, process complete lines only
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      // Last element may be incomplete — keep it in the buffer
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        processLine(line);
        if (done) return;
      }
    };

    const onErrData = (chunk: Buffer) => {
      if (done) return;
      const text = chunk.toString();
      output += text;
      if (output.length > MAX_OUTPUT && !output.includes('[output truncated')) {
        output = output.slice(0, MAX_OUTPUT) + '\n... [output truncated at 50KB]';
      }
      if (/error|Error|ERR|warn|WARN/i.test(text)) {
        const line = text.trim().split('\n').pop() || '';
        if (line) onLine(`⚠ ${line.slice(0, 120)}`);
      }
    };

    session.proc.stdout.on('data', onData);
    session.proc.stderr.on('data', onErrData);

    // Wrap: run command, capture exit, emit sentinel on its own line
    const wrapped = `${command}\n__gc=$?; echo "${sentinel}:$__gc"\n`;
    session.proc.stdin.write(wrapped);
  });
}

// ── Tool definition ───────────────────────────────────────────────────────────

export const bashTool = {
  name: 'bash',
  description: [
    'Execute a shell command. The shell is PERSISTENT — cd, exports, and env vars carry over between calls.',
    'For long-running servers use timeout: `timeout 8 npm run dev`.',
    'Avoid interactive commands (vim, less) — pipe to cat or use flags.',
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to run' },
      timeout: { type: 'number', description: 'Timeout in seconds (default: 60)' },
    },
    required: ['command'],
  },
};

export async function executeBash(
  input: { command: string; timeout?: number },
  cwd?: string,
): Promise<ToolResult> {
  const timeoutMs = (input.timeout ?? 60) * 1000;

  // ── TB bridge: proxy to container via JSON-line protocol ──────────────────
  if (isBridge()) {
    const { output, exitCode } = await executeBashBridge(input.command, timeoutMs);
    if (exitCode !== 0 && exitCode !== 124) {
      return { content: output || `Command failed with exit code ${exitCode}`, is_error: false };
    }
    return { content: output || '(no output)' };
  }
  // ─────────────────────────────────────────────────────────────────────────

  const workdir = cwd || process.cwd();
  const session = getOrCreateShell(workdir);

  const { output, exitCode } = await runInShell(
    session,
    input.command,
    timeoutMs,
    (_line) => {}, // streaming lines suppressed — show result once at end
  );

  if (exitCode !== 0 && exitCode !== 124) {
    return {
      content: `${output || '(no output)'}\n[exit code: ${exitCode}]`,
      is_error: true,
    };
  }

  return { content: output || '(no output)' };
}
