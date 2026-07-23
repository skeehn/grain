import { execFileSync } from 'child_process';
import type { AgentExecutor } from './runtime.js';
import { ExternalAgentExecutor } from './external-executor.js';
import { GrainNativeExecutor } from './grain-executor.js';
import { loadAgentProfiles } from './profiles.js';
import { StdioExecutorAdapter } from './executors.js';
import { TaskGraphStore } from './store.js';
import { WorktreeManager } from './worktree.js';
import { RunService } from '../kernel/service.js';
import { WorkflowRunner } from './workflows.js';
import type { TaskGraph } from './types.js';

/** Resolves every profile kind through one durable graph executor boundary. */
export class ProfileAgentExecutor {
  private readonly store = new TaskGraphStore(); private readonly worktrees = new WorktreeManager();
  constructor(private readonly repositoryRoot: string) {}

  executor(graphId: string): AgentExecutor {
    return async (task, signal, heartbeat) => {
      const profile = loadAgentProfiles(this.repositoryRoot).find(item => item.id === (task.profile || 'default'));
      if (!profile) throw new Error(`Unknown agent profile ${task.profile}`);
      const configured = { ...task, executor: task.executor || profile.executor, provider: task.provider || profile.provider,
        model: task.model || profile.model, budget: { ...task.budget, ...profile.budget },
        objective: profile.prompt ? `${profile.prompt}\n\nObjective:\n${task.objective}` : task.objective };
      if (configured.executor === 'grain-native' || configured.executor === 'direct-api') {
        return new GrainNativeExecutor(this.repositoryRoot).executor(graphId)(configured, signal, heartbeat);
      }
      if (configured.executor !== 'stdio') {
        return new ExternalAgentExecutor(this.repositoryRoot).executor(graphId)(configured, signal, heartbeat);
      }
      if (!profile.command) throw new Error(`${profile.id}: stdio executor requires a command`);
      const graph = this.store.load(graphId); const dependencies = configured.dependencies.map(id => graph.tasks.find(item => item.id === id)).filter(Boolean);
      const reviewedWorktree = dependencies.flatMap(item => item?.result?.evidence || []).find(item => item.startsWith('worktree:'))?.slice('worktree:'.length);
      const transaction = configured.authority.write ? this.worktrees.prepare(this.repositoryRoot, graphId, configured.id) : undefined;
      const workdir = transaction?.worktreePath || reviewedWorktree || this.repositoryRoot;
      const before = configured.authority.write ? '' : execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: workdir, encoding: 'utf8' });
      const adapter = new StdioExecutorAdapter(profile.id, profile.command); const session = await adapter.start({ objective: configured.objective,
        workdir, provider: configured.provider, model: configured.model, skills: profile.skills, authority: configured.authority,
        isolation: configured.isolation, budget: configured.budget });
      signal.addEventListener('abort', () => { void adapter.cancel(session.id); }, { once: true }); heartbeat();
      const result = await session.result;
      if (!result.success) throw new Error(result.failure?.message || result.summary);
      const after = configured.authority.write ? '' : execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: workdir, encoding: 'utf8' });
      if (!configured.authority.write && before !== after) throw new Error(`${profile.id} violated read-only authority`);
      const evidence = [...result.evidence, `agent:${profile.id}`]; let changedPaths = result.changedPaths;
      if (transaction) {
        this.worktrees.capture(transaction); this.worktrees.verify(transaction, 'git', ['diff', '--check']);
        changedPaths = execFileSync('git', ['diff', '--name-only', transaction.baseCommit], { cwd: workdir, encoding: 'utf8' }).split('\n').filter(Boolean);
        evidence.push(`verified-patch:${transaction.patchHash}`, `worktree:${transaction.worktreePath}`);
      }
      return { summary: result.summary, evidence, changedPaths, usage: { costUsd: result.usage?.costUsd,
        tokens: (result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0), wallTimeMs: 0 } };
    };
  }
}

/** Execute a profile graph while mirroring every child into the parent run journal. */
export async function executeProfileGraph(graph: TaskGraph, repositoryRoot: string, store = new TaskGraphStore()): Promise<{ graph: TaskGraph; runId: string }> {
  const first = graph.tasks[0]; const run = new RunService().create({ task: first?.objective || graph.mode, cwd: repositoryRoot,
    provider: first?.provider || 'profile', model: first?.model || first?.profile || 'auto', policy_profile: 'orchestration' });
  run.journal.transition('running', { graph_id: graph.id, mode: graph.mode });
  const base = new ProfileAgentExecutor(repositoryRoot).executor(graph.id);
  const executor: AgentExecutor = async (task, signal, heartbeat) => {
    run.journal.append('child_run_created', { graph_id: graph.id, task_id: task.id, parent_task_id: task.parentId,
      profile: task.profile, executor: task.executor, objective: task.objective });
    try {
      const result = await base(task, signal, () => { heartbeat(); run.journal.append('child_run_heartbeat', { graph_id: graph.id, task_id: task.id }); });
      run.journal.append('child_run_completed', { graph_id: graph.id, task_id: task.id, success: true,
        evidence: result.evidence, changed_paths: result.changedPaths, usage: result.usage }); return result;
    } catch (error) {
      run.journal.append('child_run_completed', { graph_id: graph.id, task_id: task.id, success: false,
        error: error instanceof Error ? error.message : String(error) }); throw error;
    }
  };
  const final = await new WorkflowRunner(store).executeConcurrent(graph.id, executor, graph.limits.maxConcurrency);
  const failed = final.tasks.filter(task => task.state !== 'succeeded');
  if (failed.length) run.journal.transition('failed', { graph_id: graph.id, failed_tasks: failed.map(task => ({ id: task.id, state: task.state, error: task.lastError })) });
  else {
    run.journal.append('verification_completed', { passed: true, graph_id: graph.id,
      evidence: final.tasks.flatMap(task => task.result?.evidence || []) });
    run.journal.transition('succeeded', { graph_id: graph.id });
  }
  return { graph: final, runId: run.journal.metadata.run_id };
}
