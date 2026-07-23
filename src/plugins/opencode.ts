import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { AgentCapability, AgentPlugin, AgentResult, AgentTask } from './types.js';

export function parseOpenCodeJSONL(output: string): { text: string; sessionId?: string; cost?: number; tokens?: number; error?: string } {
  const texts: string[] = []; let sessionId: string | undefined; let cost = 0; let tokens = 0; let semanticError: string | undefined;
  for (const line of output.split(/\r?\n/u).filter(Boolean)) try {
    const event: any = JSON.parse(line); sessionId ||= event.sessionID || event.session_id;
    const part = event.part || event;
    if (part.type === 'text' && part.text) texts.push(String(part.text));
    if (event.type === 'error') semanticError = String(event.error?.data?.message || event.error?.message || 'OpenCode reported an error');
    cost += Number(event.cost || part.cost || 0); tokens += Number(event.tokens || part.tokens || 0);
  } catch { /* OpenCode may mix a diagnostic line into JSON output */ }
  return { text: texts.join('\n').trim() || semanticError || output.trim(), sessionId, cost: cost || undefined, tokens: tokens || undefined, error: semanticError };
}

export function openCodeModelId(provider: string | undefined, model: string): string {
  if (!provider) return model;
  if (provider === 'openrouter') return model.split('/').length >= 3 ? model : `${provider}/${model}`;
  return model.startsWith(`${provider}/`) ? model : `${provider}/${model}`;
}

export class OpenCodePlugin implements AgentPlugin {
  name = 'opencode'; version = '1.x'; supportsPrintMode = true; supportsInteractive = true; supportsPTY = true;
  capabilities: AgentCapability[] = ['feature-dev', 'bug-fixing', 'refactoring', 'testing', 'code-review', 'documentation', 'debugging'];
  constructor(private readonly binaryPath = 'opencode') {}
  private environment(): NodeJS.ProcessEnv { const cache = join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'cache', 'opencode');
    mkdirSync(cache, { recursive: true }); return { ...process.env, XDG_CACHE_HOME: cache }; }
  async isInstalled(): Promise<boolean> { return this.versionCommand().then(() => true, () => false); }
  async getVersion(): Promise<string> { return this.versionCommand(); }
  private versionCommand(): Promise<string> { return new Promise((resolve, reject) => {
    let output = ''; const child = spawn(this.binaryPath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], env: this.environment() });
    child.stdout.on('data', chunk => { output += chunk; }); child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(`opencode --version exited ${code}`))); child.on('error', reject);
  }); }
  async execute(task: AgentTask): Promise<AgentResult> {
    if (task.mode !== 'oneshot') throw new Error('OpenCode adapter currently supports oneshot mode');
    const args = ['run', '--format', 'json'];
    if (task.model) args.push('--model', openCodeModelId(task.provider, task.model));
    if (task.sessionId) args.push('--session', task.sessionId);
    args.push(task.prompt);
    const started = Date.now(); return new Promise(resolve => {
      let stdout = ''; let stderr = ''; const child = spawn(this.binaryPath, args, { cwd: task.workdir,
        stdio: ['ignore', 'pipe', 'pipe'], signal: task.signal, timeout: (task.constraints?.timeoutSeconds || 180) * 1000, env: this.environment() });
      const beat = task.onHeartbeat ? setInterval(task.onHeartbeat, 10_000) : undefined;
      child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('close', (code, signal) => { if (beat) clearInterval(beat); const parsed = parseOpenCodeJSONL(stdout);
        const success = code === 0 && !parsed.error;
        resolve({ success, output: parsed.text || stderr, sessionId: parsed.sessionId, costUSD: parsed.cost,
          durationMs: Date.now() - started, exitReason: success ? 'completed' : signal ? 'timeout' : 'error',
          metadata: { exitCode: code, tokens: parsed.tokens, stderr: stderr.slice(0, 1000) } }); });
      child.on('error', error => { if (beat) clearInterval(beat); resolve({ success: false, output: error.message, exitReason: 'error' }); });
    });
  }
}
