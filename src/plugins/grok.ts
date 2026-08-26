/**
 * Grok CLI plugin — the installed `grok` binary (Grok Build TUI / grokbot).
 * Print mode (`-p`) for one-shot sub-agent work.
 */
import { spawn } from 'child_process';
import type { AgentPlugin, AgentTask, AgentResult, AgentCapability } from './types.ts';

export class GrokPlugin implements AgentPlugin {
  name = 'grok';
  version = '1.x';
  capabilities: AgentCapability[] = ['feature-dev', 'bug-fixing', 'refactoring', 'code-review', 'debugging'];
  supportsPrintMode = true;
  supportsInteractive = true;
  supportsPTY = true;

  constructor(private readonly binaryPath = 'grok') {}

  async isInstalled(): Promise<boolean> {
    return new Promise(resolve => {
      const proc = spawn(this.binaryPath, ['--version'], { stdio: 'ignore' });
      proc.on('close', code => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  async getVersion(): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      const proc = spawn(this.binaryPath, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
      proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      proc.on('close', code => code === 0 ? resolve(output.trim() || 'grok') : reject(new Error(`grok --version exited ${code}`)));
      proc.on('error', reject);
    });
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const args = [
      '-p', task.prompt,
      '--output-format', 'json',
      '--no-subagents',
      '--permission-mode', task.sandbox === 'workspace-write' ? 'acceptEdits' : 'plan',
    ];
    if (task.model && task.model !== 'auto') args.push('-m', task.model);
    if (task.sessionId) args.push('--resume', task.sessionId);
    const start = Date.now();
    return new Promise(resolve => {
      let stdout = '';
      let stderr = '';
      const proc = spawn(this.binaryPath, args, {
        cwd: task.workdir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: (task.constraints?.timeoutSeconds || 180) * 1000,
        signal: task.signal,
      });
      const heartbeat = task.onHeartbeat ? setInterval(task.onHeartbeat, 10_000) : undefined;
      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (heartbeat) clearInterval(heartbeat);
        const parsed = parseGrokOutput(stdout);
        const timedOut = code === null && signal !== null;
        resolve({
          success: code === 0,
          output: parsed.text || stdout.trim() || stderr.trim() || 'grok produced no output',
          durationMs: Date.now() - start,
          sessionId: parsed.sessionId,
          exitReason: code === 0 ? 'completed' : timedOut ? 'timeout' : 'error',
          metadata: { exitCode: code, rawStderr: stderr.slice(0, 1000) },
        });
      };
      proc.on('close', finish);
      proc.on('error', err => {
        if (heartbeat) clearInterval(heartbeat);
        resolve({ success: false, output: `Failed to spawn grok: ${err.message}`, durationMs: Date.now() - start, exitReason: 'error' });
      });
    });
  }
}

function parseGrokOutput(stdout: string): { text: string; sessionId?: string } {
  const lines = stdout.split('\n').map(line => line.trim()).filter(Boolean);
  let text = '';
  let sessionId: string | undefined;
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record.session_id || record.sessionId) sessionId = record.session_id || record.sessionId;
      if (typeof record.result === 'string') text = record.result;
      else if (typeof record.text === 'string') text += record.text;
      else if (record.type === 'assistant') {
        for (const block of record.message?.content || []) {
          if (block.type === 'text' && block.text) text += block.text;
        }
      }
    } catch { /* non-JSON lines are ignored; caller falls back to raw stdout */ }
  }
  if (!text) {
    try {
      const whole = JSON.parse(stdout);
      if (typeof whole.result === 'string') text = whole.result;
      else if (typeof whole.text === 'string') text = whole.text;
      sessionId = whole.session_id || whole.sessionId || sessionId;
    } catch { /* raw stdout used by caller */ }
  }
  return { text, sessionId };
}
