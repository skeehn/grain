import { execFileSync } from 'child_process';
import type { ExecutableTool, ToolResult } from '../providers/types.js';
import { AgentScheduler } from '../orchestration/scheduler.js';
import { TaskGraphStore } from '../orchestration/store.js';
import { WorkflowRunner } from '../orchestration/workflows.js';
import { WorktreeManager } from '../orchestration/worktree.js';
import { GrainNativeExecutor } from '../orchestration/grain-executor.js';
import type { AgentRole, AgentTask } from '../orchestration/types.js';

interface SubtaskInput { role?: string; objective: string; deliverable?: string; write?: boolean; depends_on?: number[]; provider?: string; model?: string }

const ROLES: AgentRole[] = ['driver', 'navigator', 'researcher', 'reviewer', 'verifier'];
const asRole = (r?: string): AgentRole => (ROLES.includes(r as AgentRole) ? (r as AgentRole) : 'driver');

function isGitRepo(cwd: string): boolean {
  try { execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); return true; } catch { return false; }
}

export const runAgentsTool: ExecutableTool = {
  name: 'run_agents',
  description: [
    'Run several sub-agents in PARALLEL to tackle a decomposed task. Each sub-agent is a full grain instance; write sub-agents run in an isolated git worktree and their changes are merged back automatically.',
    'Provide `tasks` (2-8) with objectives; set write:true for tasks that change files; use depends_on (indices of EARLIER tasks) to order dependent work. Prefer this over sequential delegate when subtasks are independent (e.g. edit N files, research M topics).',
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      objective: { type: 'string', description: 'One-line description of the overall goal' },
      tasks: {
        type: 'array',
        description: '2-8 sub-tasks to run',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ROLES, description: 'driver/navigator do work; researcher/reviewer/verifier are read-only' },
            objective: { type: 'string' },
            deliverable: { type: 'string', description: 'What this sub-agent should produce' },
            write: { type: 'boolean', description: 'true if it edits files (runs in an isolated worktree)' },
            depends_on: { type: 'array', items: { type: 'number' }, description: 'indices of earlier tasks this one needs' },
          },
          required: ['objective'],
        },
      },
      concurrency: { type: 'number', description: 'Max parallel sub-agents (1-8, default 4)' },
    },
    required: ['tasks'],
  },
  async execute(input: { objective?: string; tasks: SubtaskInput[]; concurrency?: number }): Promise<ToolResult> {
    // Nested agents never launch processes themselves. They submit expansion
    // requests to their durable parent graph; the outer scheduler owns limits,
    // leases, execution, and recovery.
    if (process.env.GRAIN_SUBAGENT === '1') {
      const graphId = process.env.GRAIN_GRAPH_ID; const parentTaskId = process.env.GRAIN_PARENT_TASK_ID;
      if (!graphId || !parentTaskId) return { content: 'Nested orchestration requires scheduler graph identity.', is_error: true };
      const tasks = Array.isArray(input.tasks) ? input.tasks : [];
      if (tasks.length < 1 || tasks.length > 8) return { content: 'Nested expansion requires 1-8 tasks.', is_error: true };
      try {
        const store = new TaskGraphStore(); const scheduler = new AgentScheduler(); const created: string[] = [];
        store.update(graphId, graph => {
          for (let index = 0; index < tasks.length; index++) {
            const task = tasks[index];
            if (!task.objective?.trim()) throw new Error(`Task ${index} is missing an objective.`);
            const dependencies = (task.depends_on || []).map(dependencyIndex => {
              if (dependencyIndex < 0 || dependencyIndex >= index) {
                throw new Error(`Task ${index} depends_on ${dependencyIndex}, which must be an earlier task index`);
              }
              return created[dependencyIndex];
            });
            const expanded = scheduler.expand(graph, { parentTaskId, role: asRole(task.role), objective: task.objective,
              expectedArtifact: task.deliverable || task.objective, write: !!task.write, profile: undefined, dependencies });
            expanded.provider = task.provider; expanded.model = task.model; created.push(expanded.id);
          }
        });
        return { content: `Queued ${created.length} scheduler-owned child task(s): ${created.join(', ')}` };
      } catch (error) { return { content: error instanceof Error ? error.message : String(error), is_error: true }; }
    }
    const cwd = process.cwd();
    const tasks = Array.isArray(input.tasks) ? input.tasks : [];
    if (tasks.length < 1) return { content: 'run_agents needs at least one task.', is_error: true };
    if (tasks.length > 8) return { content: 'run_agents supports at most 8 tasks.', is_error: true };
    if (!isGitRepo(cwd)) return { content: 'run_agents needs a git repository (write sub-agents use worktrees). Run "git init" first.', is_error: true };

    const scheduler = new AgentScheduler();
    const store = new TaskGraphStore();
    const graph = scheduler.createGraph('swarm', { maxConcurrency: Math.max(1, Math.min(8, input.concurrency || 4)) });
    const idByIndex: string[] = [];
    try {
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (!t.objective?.trim()) return { content: `Task ${i} is missing an objective.`, is_error: true };
        const deps = (t.depends_on || []).map(d => {
          if (d < 0 || d >= i) throw new Error(`Task ${i} depends_on ${d}, which must be an earlier task index`);
          return idByIndex[d];
        });
        const created = scheduler.addTask(graph, {
          role: asRole(t.role), objective: t.objective, expectedArtifact: t.deliverable || t.objective,
          dependencies: deps, write: !!t.write, provider: t.provider, model: t.model,
        });
        idByIndex.push(created.id);
      }
    } catch (e: any) {
      return { content: `Could not build the task graph: ${e?.message || e}`, is_error: true };
    }
    store.save(graph);

    const concurrency = Math.max(1, Math.min(8, input.concurrency || 4));
    const executor = new GrainNativeExecutor(cwd).executor(graph.id);
    let final;
    try {
      final = await new WorkflowRunner(store).executeConcurrent(graph.id, executor, concurrency);
    } catch (e: any) {
      return { content: `Orchestration failed: ${e?.message || e}`, is_error: true };
    }

    // Merge verified write-worktrees back into the repo (sequentially — later
    // patches can conflict with earlier ones; report honestly).
    const worktrees = new WorktreeManager();
    const mergeNotes: string[] = [];
    const conflicts: string[] = [];
    for (const task of final.tasks.filter(t => t.authority.write && t.state === 'succeeded')) {
      let txn;
      try { txn = worktrees.load(graph.id, task.id); } catch { continue; } // no worktree / no patch
      if (txn.state !== 'verified') continue; // nothing to merge
      const merged = worktrees.merge(txn);
      if (merged.state === 'merged') mergeNotes.push(`${task.role}: merged ${(task.result?.changedPaths || []).length} file(s)`);
      else { conflicts.push(`${task.role}: ${merged.error || 'merge conflict'}`); }
      cleanupWorktree(cwd, txn.worktreePath, txn.branch);
    }
    // Clean up worktrees for non-merged write tasks too.
    for (const task of final.tasks.filter(t => t.authority.write && t.state !== 'succeeded')) {
      try { const txn = worktrees.load(graph.id, task.id); cleanupWorktree(cwd, txn.worktreePath, txn.branch); } catch { /* ignore */ }
    }

    return { content: report(input.objective, final.tasks, idByIndex, mergeNotes, conflicts), is_error: conflicts.length > 0 };
  },
};

function cleanupWorktree(repoRoot: string, worktreePath: string, branch: string): void {
  try { execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot, stdio: 'ignore' }); } catch { /* already gone */ }
  try { execFileSync('git', ['branch', '-D', branch], { cwd: repoRoot, stdio: 'ignore' }); } catch { /* already gone */ }
}

function report(objective: string | undefined, tasks: AgentTask[], idByIndex: string[], mergeNotes: string[], conflicts: string[]): string {
  const lines: string[] = [];
  if (objective) lines.push(`Objective: ${objective}`);
  lines.push(`Ran ${tasks.length} sub-agent(s):`);
  tasks.forEach((task, i) => {
    const idx = idByIndex.indexOf(task.id);
    const mark = task.state === 'succeeded' ? '✓' : task.state === 'needs_reconciliation' ? '△' : '✗';
    lines.push(`  ${mark} [${idx >= 0 ? idx : i}] ${task.role} — ${task.objective}`);
    if (task.result?.summary) lines.push(`      ${task.result.summary.split('\n').join(' ').slice(0, 200)}`);
    if (task.lastError) lines.push(`      error: ${task.lastError.slice(0, 200)}`);
    const changed = task.result?.changedPaths || [];
    if (changed.length) lines.push(`      changed: ${changed.slice(0, 8).join(', ')}${changed.length > 8 ? ` (+${changed.length - 8})` : ''}`);
  });
  if (mergeNotes.length) lines.push('', 'Merged into your working tree:', ...mergeNotes.map(n => `  ${n}`));
  if (conflicts.length) lines.push('', 'NOT merged (conflicts — resolve manually):', ...conflicts.map(c => `  ${c}`));
  return lines.join('\n');
}
