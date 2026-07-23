import { spawn } from 'child_process';
import type { AgentCapability, AgentPlugin, AgentResult, AgentTask } from './types.js';

export class HermesPlugin implements AgentPlugin {
  name = 'hermes'; version = '0.x'; supportsPrintMode = true; supportsInteractive = true; supportsPTY = true;
  capabilities: AgentCapability[] = ['feature-dev', 'bug-fixing', 'testing', 'code-review', 'documentation', 'debugging'];
  constructor(private readonly binaryPath = 'hermes') {}
  async isInstalled(): Promise<boolean> { return this.versionCommand().then(() => true, () => false); }
  async getVersion(): Promise<string> { return this.versionCommand(); }
  private versionCommand(): Promise<string> { return new Promise((resolve, reject) => {
    let output = ''; const child = spawn(this.binaryPath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = (chunk: Buffer) => { output += chunk.toString(); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('close', code => code === 0 || /Hermes Agent v\d/iu.test(output) ? resolve(output.trim()) : reject(new Error(`hermes --version exited ${code}`))); child.on('error', reject);
  }); }
  async execute(task: AgentTask): Promise<AgentResult> {
    if (task.mode !== 'oneshot') throw new Error('Hermes adapter currently supports oneshot mode');
    const args = ['chat', '--quiet', '--source', 'tool', '--max-turns', String(task.constraints?.maxTurns || 20)];
    if (task.provider) args.push('--provider', task.provider); if (task.model) args.push('--model', task.model);
    if (task.skills?.length) args.push('--skills', task.skills.join(',')); if (task.sessionId) args.push('--resume', task.sessionId);
    // Hermes has no read-only flag. Grain runs it in a read-only shared repo and
    // verifies git state, or a disposable worktree for writers. Never pass --yolo.
    args.push('--query', task.prompt);
    const started = Date.now(); return new Promise(resolve => {
      let stdout = ''; let stderr = ''; const child = spawn(this.binaryPath, args, { cwd: task.workdir,
        stdio: ['ignore', 'pipe', 'pipe'], signal: task.signal, timeout: (task.constraints?.timeoutSeconds || 180) * 1000 });
      const beat = task.onHeartbeat ? setInterval(task.onHeartbeat, 10_000) : undefined;
      child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('close', (code, signal) => { if (beat) clearInterval(beat);
        const sessionId = stdout.match(/(?:session(?:_id)?|Session)\s*[:=]\s*([\w-]+)/iu)?.[1];
        resolve({ success: code === 0, output: stdout.trim() || stderr.trim(), sessionId, durationMs: Date.now() - started,
          exitReason: code === 0 ? 'completed' : signal ? 'timeout' : 'error', metadata: { exitCode: code, stderr: stderr.slice(0, 1000) } }); });
      child.on('error', error => { if (beat) clearInterval(beat); resolve({ success: false, output: error.message, exitReason: 'error' }); });
    });
  }
}
