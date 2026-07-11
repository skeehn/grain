import { execFileSync } from 'child_process';
import { ClaudeCodePlugin } from '../plugins/claude-code.js';
import { CodexPlugin } from '../plugins/codex.js';
import type { AgentPlugin, AgentTask as PluginTask } from '../plugins/types.js';
import type { AgentExecutor } from './runtime.js';
import type { AgentTask } from './types.js';
import { WorktreeManager } from './worktree.js';
import { TaskGraphStore } from './store.js';

export class ExternalAgentExecutor {
  private readonly codex = new CodexPlugin();
  private readonly claude = new ClaudeCodePlugin();
  private readonly worktrees = new WorktreeManager();
  private readonly store = new TaskGraphStore();
  constructor(private readonly repositoryRoot: string) {}

  private async pluginsFor(task: AgentTask): Promise<AgentPlugin[]> {
    const preferred = task.role === 'driver' ? this.codex : this.claude;
    const fallback = preferred === this.codex ? this.claude : this.codex;
    const installed: AgentPlugin[] = [];
    if (await preferred.isInstalled()) installed.push(preferred);
    if (await fallback.isInstalled()) installed.push(fallback);
    if (!installed.length) throw new Error('Neither Codex nor Claude Code is installed');
    return installed;
  }

  executor(graphId: string): AgentExecutor {
    return async (task, signal, heartbeat) => {
      const graph = this.store.load(graphId);
      const dependencies = task.dependencies.map(id => graph.tasks.find(item => item.id === id)).filter(Boolean);
      const dependencyEvidence = dependencies.flatMap(item => item?.result?.evidence || []);
      const reviewedWorktree = dependencyEvidence.find(item => item.startsWith('worktree:'))?.slice('worktree:'.length);
      const transaction = task.authority.write ? this.worktrees.prepare(this.repositoryRoot, graphId, task.id) : undefined;
      const workdir = transaction?.worktreePath || reviewedWorktree || this.repositoryRoot;
      const beforeReadOnly = task.authority.write ? '' : execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: workdir, encoding: 'utf8' });
      const plugins = await this.pluginsFor(task);
      const prompt = [
        `Role: ${task.role}`,
        `Objective: ${task.objective}`,
        `Required artifact: ${task.expectedArtifact}`,
        `Authority: read=${task.authority.read}, write=${task.authority.write}, network=${task.authority.network}, destructive=false`,
        dependencies.length ? `Dependency evidence:\n${dependencies.map(item => `${item!.role}: ${item!.result?.summary}\n${(item!.result?.evidence || []).join('\n')}`).join('\n\n')}` : '',
        'Do not commit, push, publish, delete branches, or modify files outside the provided working directory.',
        'Finish with a concise result and concrete verification evidence.',
      ].join('\n');
      const pluginTask: PluginTask = { prompt, workdir, mode: 'oneshot', signal, onHeartbeat: heartbeat,
        sandbox: task.authority.write ? 'workspace-write' : 'read-only',
        constraints: { maxTurns: task.budget.maxTurns, maxBudgetUSD: task.budget.maxCostUsd,
          timeoutSeconds: Math.ceil(task.budget.timeoutMs / 1000) } };
      let plugin: AgentPlugin | undefined; let result: Awaited<ReturnType<AgentPlugin['execute']>> | undefined;
      const failures: string[] = [];
      for (const candidate of plugins) {
        const attempt = await candidate.execute(pluginTask);
        if (attempt.success) { plugin = candidate; result = attempt; break; }
        failures.push(`${candidate.name}: ${attempt.output || attempt.exitReason || 'unknown failure'}`);
      }
      if (!plugin || !result) throw new Error(`All external agents failed: ${failures.join(' | ')}`);
      if (!task.authority.write) {
        const afterReadOnly = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: workdir, encoding: 'utf8' });
        if (afterReadOnly !== beforeReadOnly) throw new Error(`${plugin.name} violated read-only authority`);
      }
      const evidence = [`agent:${plugin.name}`, `exit:${result.exitReason || 'completed'}`];
      let changedPaths = result.filesModified || [];
      if (transaction) {
        this.worktrees.capture(transaction); this.worktrees.verify(transaction, 'git', ['diff', '--check']);
        changedPaths = execFileSync('git', ['diff', '--name-only', transaction.baseCommit], { cwd: workdir, encoding: 'utf8' }).split('\n').filter(Boolean);
        evidence.push(`verified-patch:${transaction.patchHash}`, `worktree:${transaction.worktreePath}`);
      } else evidence.push('read-only-shared-workspace');
      if (result.costUSD !== undefined) evidence.push(`cost-usd:${result.costUSD.toFixed(6)}`);
      return { summary: result.output || `${plugin.name} completed`, evidence, changedPaths };
    };
  }
}
