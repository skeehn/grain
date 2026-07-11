import { randomUUID } from 'crypto';
import { AgentScheduler } from './scheduler.js';
import { TaskGraphStore } from './store.js';
import type { AgentTask, TaskGraph } from './types.js';

export interface AgentExecutionResult { summary: string; evidence: string[]; changedPaths: string[]; }
export type AgentExecutor = (task: AgentTask, signal: AbortSignal, heartbeat: () => void) => Promise<AgentExecutionResult>;

export class DurableAgentRuntime {
  private readonly scheduler = new AgentScheduler();
  constructor(private readonly store = new TaskGraphStore(), private readonly workerId = `worker-${randomUUID()}`) {}

  recover(graphId: string, now = Date.now()): TaskGraph {
    const graph = this.store.load(graphId); this.scheduler.recoverExpired(graph, now); this.store.save(graph); return graph;
  }

  cancel(graphId: string, taskId: string): TaskGraph {
    const graph = this.store.load(graphId); this.scheduler.requestCancellation(graph, taskId); this.store.save(graph); return graph;
  }

  async runReady(graphId: string, executor: AgentExecutor): Promise<TaskGraph> {
    let graph = this.recover(graphId);
    for (const ready of this.scheduler.ready(graph)) {
      this.scheduler.acquire(graph, ready.id, this.workerId); this.store.save(graph);
      const controller = new AbortController();
      const heartbeat = () => {
        graph = this.store.load(graphId);
        const current = graph.tasks.find(task => task.id === ready.id);
        if (current?.cancellationRequestedAt) { controller.abort(); return; }
        this.scheduler.heartbeat(graph, ready.id, this.workerId); this.store.save(graph);
      };
      try {
        const latest = this.store.load(graphId).tasks.find(task => task.id === ready.id)!;
        if (latest.cancellationRequestedAt) controller.abort();
        const result = await executor(latest, controller.signal, heartbeat);
        graph = this.store.load(graphId);
        const current = graph.tasks.find(task => task.id === ready.id)!;
        if (current.cancellationRequestedAt) { current.state = 'cancelled'; current.lease = undefined; }
        else this.scheduler.complete(graph, ready.id, result);
      } catch (error: any) {
        graph = this.store.load(graphId); const task = graph.tasks.find(item => item.id === ready.id)!;
        task.lastError = String(error?.message || error); task.lease = undefined;
        task.state = task.authority.write ? 'needs_reconciliation' : 'failed'; task.updatedAt = new Date().toISOString();
      }
      this.store.save(graph);
    }
    return this.store.load(graphId);
  }

  async runTask(graphId: string, taskId: string, executor: AgentExecutor): Promise<void> {
    let leased!: AgentTask;
    this.store.update(graphId, graph => { leased = structuredClone(this.scheduler.acquire(graph, taskId, this.workerId)); });
    const controller = new AbortController();
    const heartbeat = () => this.store.update(graphId, graph => {
      const current = graph.tasks.find(task => task.id === taskId);
      if (current?.cancellationRequestedAt) { controller.abort(); return; }
      this.scheduler.heartbeat(graph, taskId, this.workerId);
    });
    try {
      const result = await executor(leased, controller.signal, heartbeat);
      this.store.update(graphId, graph => {
        const current = graph.tasks.find(task => task.id === taskId)!;
        if (current.cancellationRequestedAt) { current.state = 'cancelled'; current.lease = undefined; }
        else this.scheduler.complete(graph, taskId, result);
      });
    } catch (error: any) {
      this.store.update(graphId, graph => {
        const task = graph.tasks.find(item => item.id === taskId)!;
        task.lastError = String(error?.message || error); task.lease = undefined;
        task.state = task.authority.write ? 'needs_reconciliation' : 'failed';
        task.updatedAt = new Date().toISOString();
      });
    }
  }
}
