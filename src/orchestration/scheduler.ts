import { randomUUID } from 'crypto';
import { DEFAULT_RUN_TREE_LIMITS, HARD_RUN_TREE_LIMITS, type AgentExpansionRequest, type AgentRole, type AgentTask, type RunTreeLimits, type TaskGraph } from './types.js';

export class AgentScheduler {
  createGraph(mode: TaskGraph['mode'], limits: Partial<RunTreeLimits> = {}): TaskGraph {
    const resolved = { ...DEFAULT_RUN_TREE_LIMITS, ...limits };
    for (const key of Object.keys(resolved) as Array<keyof RunTreeLimits>) {
      if (!Number.isFinite(resolved[key]) || resolved[key] < 1 || resolved[key] > HARD_RUN_TREE_LIMITS[key]) {
        throw new Error(`${key} must be between 1 and ${HARD_RUN_TREE_LIMITS[key]}`);
      }
    }
    return { id: randomUUID(), mode, tasks: [], limits: resolved,
      usage: { turns: 0, tokens: 0, costUsd: 0, wallTimeMs: 0, toolCalls: 0 }, createdAt: new Date().toISOString() };
  }

  addTask(graph: TaskGraph, input: {
    parentId?: string; role: AgentRole; objective: string; expectedArtifact: string; dependencies?: string[];
    write?: boolean; provider?: string; model?: string; profile?: string; executor?: AgentTask['executor']; budget?: Partial<AgentTask['budget']>;
  }): AgentTask {
    if (!input.objective.trim() || !input.expectedArtifact.trim()) throw new Error('Task objective and artifact are required');
    const dependencies = input.dependencies || [];
    for (const id of dependencies) if (!graph.tasks.some(task => task.id === id)) throw new Error(`Unknown dependency ${id}`);
    const now = new Date().toISOString();
    const write = !!input.write;
    const parent = input.parentId ? graph.tasks.find(task => task.id === input.parentId) : undefined;
    if (input.parentId && !parent) throw new Error(`Unknown parent task ${input.parentId}`);
    const depth = parent ? parent.depth + 1 : 0;
    if (depth > graph.limits.maxDepth) throw new Error(`Agent recursion depth ${depth} exceeds graph limit ${graph.limits.maxDepth}`);
    if (graph.tasks.length >= graph.limits.maxAgents) throw new Error(`Agent graph limit ${graph.limits.maxAgents} reached`);
    const task: AgentTask = {
      id: randomUUID(), parentId: input.parentId, role: input.role, objective: input.objective,
      expectedArtifact: input.expectedArtifact, state: dependencies.length ? 'pending' : 'ready',
      isolation: write ? 'worktree' : 'shared_readonly', dependencies,
      provider: input.provider, model: input.model, profile: input.profile, executor: input.executor, depth,
      budget: { maxTurns: 20, maxCostUsd: 5, timeoutMs: 30 * 60_000, ...input.budget },
      authority: { read: true, write, network: false, destructive: false }, createdAt: now, updatedAt: now,
      attempts: 0,
    };
    graph.tasks.push(task);
    this.assertAcyclic(graph);
    return task;
  }

  /** The scheduler, never a child process, is the authority that expands a graph. */
  expand(graph: TaskGraph, request: AgentExpansionRequest): AgentTask {
    const parent = graph.tasks.find(task => task.id === request.parentTaskId);
    if (!parent) throw new Error(`Unknown parent task ${request.parentTaskId}`);
    const children = graph.tasks.filter(task => task.parentId === parent.id);
    if (children.length >= graph.limits.maxConcurrency) throw new Error(`Parent fan-out limit ${graph.limits.maxConcurrency} reached`);
    return this.addTask(graph, { parentId: parent.id, role: request.role, objective: request.objective,
      expectedArtifact: request.expectedArtifact, dependencies: request.dependencies, write: request.write,
      profile: request.profile, budget: request.budget });
  }

  ready(graph: TaskGraph): AgentTask[] {
    const succeeded = new Set(graph.tasks.filter(task => task.state === 'succeeded').map(task => task.id));
    for (const task of graph.tasks) if (task.state === 'pending' && task.dependencies.every(id => succeeded.has(id))) task.state = 'ready';
    return graph.tasks.filter(task => task.state === 'ready');
  }

  complete(graph: TaskGraph, id: string, result: NonNullable<AgentTask['result']>): void {
    const task = graph.tasks.find(item => item.id === id);
    if (!task) throw new Error(`Unknown task ${id}`);
    if (!['ready', 'running'].includes(task.state)) throw new Error(`Cannot complete task in ${task.state}`);
    if (!result.summary.trim() || result.evidence.length === 0) throw new Error('Completion requires summary and evidence');
    task.result = result; task.state = 'succeeded'; task.lease = undefined; task.updatedAt = new Date().toISOString();
    for (const key of ['turns', 'tokens', 'costUsd', 'wallTimeMs', 'toolCalls'] as const) graph.usage[key] += Number(result.usage?.[key] || 0);
    const exceeded = graph.usage.turns > graph.limits.maxTurns ? `turn budget ${graph.limits.maxTurns}`
      : graph.usage.tokens > graph.limits.maxTokens ? `token budget ${graph.limits.maxTokens}`
      : graph.usage.costUsd > graph.limits.maxCostUsd ? `cost budget $${graph.limits.maxCostUsd}`
      : graph.usage.wallTimeMs > graph.limits.timeoutMs ? `wall-time budget ${graph.limits.timeoutMs}ms`
      : graph.usage.toolCalls > graph.limits.maxToolCalls ? `tool-call budget ${graph.limits.maxToolCalls}` : undefined;
    if (exceeded) {
      graph.budgetExceeded = exceeded;
      for (const pending of graph.tasks) if (pending.state === 'pending' || pending.state === 'ready' || pending.state === 'waiting') {
        pending.state = 'cancelled'; pending.lastError = `Run tree exceeded ${exceeded}`; pending.updatedAt = task.updatedAt;
      }
    }
    this.ready(graph);
  }

  acquire(graph: TaskGraph, id: string, owner: string, leaseMs = 30_000, now = Date.now()): AgentTask {
    if (graph.budgetExceeded) throw new Error(`Run tree exceeded ${graph.budgetExceeded}`);
    const task = graph.tasks.find(item => item.id === id);
    if (!task) throw new Error(`Unknown task ${id}`);
    if (task.state !== 'ready') throw new Error(`Task ${id} is not ready`);
    const acquiredAt = new Date(now).toISOString();
    task.state = 'running'; task.attempts += 1;
    task.lease = { owner, acquiredAt, heartbeatAt: acquiredAt, expiresAt: new Date(now + leaseMs).toISOString() };
    task.updatedAt = acquiredAt; return task;
  }

  heartbeat(graph: TaskGraph, id: string, owner: string, leaseMs = 30_000, now = Date.now()): void {
    const task = graph.tasks.find(item => item.id === id);
    if (!task?.lease || task.lease.owner !== owner || task.state !== 'running') throw new Error('Heartbeat rejected: lease owner mismatch');
    task.lease.heartbeatAt = new Date(now).toISOString(); task.lease.expiresAt = new Date(now + leaseMs).toISOString();
    task.updatedAt = task.lease.heartbeatAt;
  }

  requestCancellation(graph: TaskGraph, id: string, now = Date.now()): void {
    const task = graph.tasks.find(item => item.id === id); if (!task) throw new Error(`Unknown task ${id}`);
    task.cancellationRequestedAt = new Date(now).toISOString();
    if (task.state === 'pending' || task.state === 'ready' || task.state === 'waiting') task.state = 'cancelled';
    task.updatedAt = task.cancellationRequestedAt;
  }

  recoverExpired(graph: TaskGraph, now = Date.now()): AgentTask[] {
    const recovered: AgentTask[] = [];
    for (const task of graph.tasks) {
      if (task.state !== 'running' || !task.lease || Date.parse(task.lease.expiresAt) > now) continue;
      task.lastError = 'worker lease expired during execution'; task.lease = undefined;
      task.state = task.authority.write ? 'needs_reconciliation' : 'ready'; task.updatedAt = new Date(now).toISOString();
      recovered.push(task);
    }
    return recovered;
  }

  private assertAcyclic(graph: TaskGraph): void {
    const visiting = new Set<string>(); const visited = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) throw new Error('Task graph contains a dependency cycle');
      if (visited.has(id)) return;
      visiting.add(id);
      const task = graph.tasks.find(item => item.id === id);
      for (const dep of task?.dependencies || []) visit(dep);
      visiting.delete(id); visited.add(id);
    };
    for (const task of graph.tasks) visit(task.id);
  }
}
