// A grain-native executor for the durable orchestration runtime. Where the
// ExternalAgentExecutor shells out to codex/claude-code, this one spawns GRAIN
// itself — one isolated grain process per task, each in its own git worktree
// for write tasks — so the model can run parallel, worktree-isolated subagents
// that manage well and merge back. Implements the same AgentExecutor contract.
import { execFileSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { AgentExecutor } from './runtime.js';
import type { AgentTask } from './types.js';
import { WorktreeManager } from './worktree.js';
import { TaskGraphStore } from './store.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Locate the grain binary to spawn subagents with — the same harness as the parent. */
export function grainBinary(): { cmd: string; prefixArgs: string[] } {
  if (process.env.GRAIN_BIN) return { cmd: process.env.GRAIN_BIN, prefixArgs: [] };
  const exec = process.execPath;
  // A compiled grain binary re-runs grain when invoked directly.
  if (/grain/i.test(exec)) return { cmd: exec, prefixArgs: [] };
  const deployed = join(homedir(), 'bin', 'grain');
  if (existsSync(deployed)) return { cmd: deployed, prefixArgs: [] };
  // Dev fallback: bun run src/cli.ts
  return { cmd: exec, prefixArgs: process.argv[1] ? [process.argv[1]] : [] };
}

/** Run one grain subagent to completion in `cwd`, honoring cancellation + heartbeat. */
function runGrain(
  graphId: string, prompt: string, cwd: string, task: AgentTask, signal: AbortSignal, heartbeat: () => void,
): Promise<{ output: string; code: number }> {
  const { cmd, prefixArgs } = grainBinary();
  const args = [...prefixArgs, '-p', prompt, '--yes', '--concise'];
  if (task.provider) args.push('--provider', task.provider);
  if (task.model) args.push('--model', task.model);
  args.push('--max-turns', String(task.budget.maxTurns));

  return new Promise((resolve, reject) => {
    // A child may propose more work, but only the durable scheduler identified
    // by these IDs is allowed to add it to the graph.
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GRAIN_MACHINE: '0',
      GRAIN_SUBAGENT: '1', GRAIN_GRAPH_ID: graphId, GRAIN_PARENT_TASK_ID: task.id } });
    let output = '';
    const cap = (b: Buffer) => { output += b.toString(); if (output.length > 200_000) output = output.slice(-200_000); };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    const beat = setInterval(heartbeat, 10_000);
    const onAbort = () => child.kill('SIGTERM');
    signal.addEventListener('abort', onAbort);
    const wall = setTimeout(() => child.kill('SIGTERM'), Math.max(60_000, task.budget.timeoutMs));
    child.on('close', code => {
      clearInterval(beat); clearTimeout(wall); signal.removeEventListener('abort', onAbort);
      resolve({ output, code: code ?? 1 });
    });
    child.on('error', err => { clearInterval(beat); clearTimeout(wall); reject(err); });
  });
}

export class GrainNativeExecutor {
  private readonly worktrees = new WorktreeManager();
  private readonly store = new TaskGraphStore();
  constructor(private readonly repositoryRoot: string) {}

  executor(graphId: string): AgentExecutor {
    return async (task, signal, heartbeat) => {
      const graph = this.store.load(graphId);
      const deps = task.dependencies.map(id => graph.tasks.find(t => t.id === id)).filter(Boolean);
      const depContext = deps
        .filter(d => d?.result)
        .map(d => `- ${d!.role} (${d!.objective}): ${d!.result!.summary}`)
        .join('\n');
      const reviewedWorktree = deps.flatMap(dependency => dependency?.result?.evidence || [])
        .find(item => item.startsWith('worktree:'))?.slice('worktree:'.length);

      const transaction = task.authority.write ? this.worktrees.prepare(this.repositoryRoot, graphId, task.id) : undefined;
      const workdir = transaction?.worktreePath || reviewedWorktree || this.repositoryRoot;
      const before = task.authority.write ? '' : git(workdir, ['status', '--porcelain=v1', '--untracked-files=all']);

      const prompt = [
        `You are the "${task.role}" sub-agent in a coordinated multi-agent task.`,
        `Objective: ${task.objective}`,
        task.expectedArtifact ? `Deliverable: ${task.expectedArtifact}` : '',
        depContext ? `Results from tasks you depend on:\n${depContext}` : '',
        task.authority.write
          ? 'Make the changes needed to complete your objective in this working directory. Do not commit, push, or touch files outside it.'
          : 'This is a read-only task. Investigate and report; do not modify any files.',
        'Finish with a concise summary of what you did and concrete evidence.',
      ].filter(Boolean).join('\n\n');

      const { output, code } = await runGrain(graphId, prompt, workdir, task, signal, heartbeat);
      const summary = output.replace(/\s+$/, '').split('\n').slice(-12).join('\n').slice(0, 2000) || 'sub-agent completed';
      if (code !== 0) throw new Error(`grain sub-agent exited ${code}: ${summary.slice(-400)}`);

      if (!task.authority.write) {
        const after = git(workdir, ['status', '--porcelain=v1', '--untracked-files=all']);
        if (after !== before) throw new Error(`${task.role} violated read-only authority (modified the workspace)`);
        return { summary, evidence: ['read-only-verified'], changedPaths: [] };
      }

      // Capture + verify the worktree patch; the tool merges verified patches back.
      let changedPaths: string[] = [];
      try {
        this.worktrees.capture(transaction!);
        this.worktrees.verify(transaction!, 'git', ['diff', '--check']);
        changedPaths = git(workdir, ['diff', '--name-only', transaction!.baseCommit]).split('\n').filter(Boolean);
      } catch (e: any) {
        // No patch (task made no changes) is fine; a real verify failure is not.
        if (!/produced no patch/.test(String(e?.message))) throw e;
      }
      return {
        summary,
        evidence: [`agent:grain`, `worktree:${transaction!.worktreePath}`, `patch:${transaction!.patchHash || 'none'}`],
        changedPaths,
      };
    };
  }
}
