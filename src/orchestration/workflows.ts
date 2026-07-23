import { DurableAgentRuntime } from './runtime.js';
import { TaskGraphStore } from './store.js';
import type { AgentExecutor } from './runtime.js';
import type { TaskGraph } from './types.js';

export class WorkflowRunner {
  constructor(private readonly store = new TaskGraphStore()) {}
  async execute(graphId: string, executor: AgentExecutor): Promise<TaskGraph> {
    const runtime = new DurableAgentRuntime(this.store);
    let graph = this.store.load(graphId);
    for (let wave = 0; wave < 100; wave++) {
      const before = JSON.stringify(graph.tasks.map(task => [task.id, task.state, task.attempts]));
      graph = await runtime.runReady(graphId, executor);
      const terminal = graph.tasks.every(task => ['succeeded', 'failed', 'cancelled', 'needs_reconciliation'].includes(task.state));
      if (terminal) return graph;
      const after = JSON.stringify(graph.tasks.map(task => [task.id, task.state, task.attempts]));
      if (before === after) return graph;
    }
    throw new Error('Workflow exceeded 100 scheduling waves');
  }

  async executeConcurrent(graphId: string, executor: AgentExecutor, maxConcurrency = 4): Promise<TaskGraph> {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 8) throw new Error('Concurrency must be between 1 and 8');
    const runtime = new DurableAgentRuntime(this.store);
    for (let wave = 0; wave < 100; wave++) {
      const graph = runtime.recover(graphId);
      const ready = graph.tasks.filter(task => task.state === 'ready');
      if (!ready.length) return graph;
      for (let index = 0; index < ready.length; index += maxConcurrency) {
        await Promise.all(ready.slice(index, index + maxConcurrency).map(task => runtime.runTask(graphId, task.id, executor)));
      }
      const after = this.store.load(graphId);
      if (after.tasks.some(task => task.state === 'needs_reconciliation')) return after;
      if (after.tasks.every(task => ['succeeded', 'failed', 'cancelled'].includes(task.state))) return after;
    }
    throw new Error('Concurrent workflow exceeded 100 scheduling waves');
  }
}

export interface RepairAttemptResult { passed: boolean; fingerprint: string; summary: string; evidence: string[]; }

export class RepairLoopRunner {
  async execute(repair: (attempt: number, prior?: RepairAttemptResult) => Promise<RepairAttemptResult>, maxAttempts = 5): Promise<RepairAttemptResult> {
    if (maxAttempts < 1 || maxAttempts > 20) throw new Error('Repair attempts must be between 1 and 20');
    let prior: RepairAttemptResult | undefined;
    const fingerprints = new Set<string>();
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await repair(attempt, prior);
      if (!result.evidence.length) throw new Error('Repair verifier must provide evidence');
      if (result.passed) return result;
      if (fingerprints.has(result.fingerprint)) throw new Error(`Repair loop stagnated on fingerprint ${result.fingerprint}`);
      fingerprints.add(result.fingerprint); prior = result;
    }
    throw new Error(`Repair loop exhausted ${maxAttempts} attempts`);
  }
}
