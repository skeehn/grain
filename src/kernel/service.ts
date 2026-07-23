import { RunEngine } from './engine.js';
import { listRuns, readRunEvents, replayRun, RunJournal } from './journal.js';
import type { RunEvent, RunFailureCategory, RunFailureShape, RunMetadata, RunState } from './types.js';

const TERMINAL = new Set<RunState['status']>(['succeeded', 'failed', 'cancelled']);

export class RunFailure extends Error implements RunFailureShape {
  readonly name = 'RunFailure';
  constructor(
    readonly category: RunFailureCategory,
    message: string,
    readonly retryable = false,
    readonly user_action?: string,
    readonly cause?: unknown,
  ) { super(message); }

  toJSON(): RunFailureShape {
    return { category: this.category, message: this.message, retryable: this.retryable,
      ...(this.user_action ? { user_action: this.user_action } : {}), ...(this.cause ? { cause: this.cause } : {}) };
  }
}

export interface CreateRunInput extends Omit<RunMetadata, 'run_id' | 'created_at' | 'correlation_id'> {
  run_id?: string;
  correlation_id?: string;
}

export interface RunHandle {
  journal: RunJournal;
  engine: RunEngine;
  state(): RunState;
}

/** Public authority for creating, controlling, recovering, and observing runs. */
export class RunService {
  create(input: CreateRunInput): RunHandle {
    const journal = RunJournal.create({ ...input, correlation_id: input.correlation_id });
    const engine = new RunEngine(journal);
    return { journal, engine, state: () => engine.state() };
  }

  resume(runId: string): RunHandle {
    const journal = RunJournal.open(runId);
    const engine = new RunEngine(journal);
    if (engine.state().status === 'paused') engine.dispatch({ type: 'resume' });
    return { journal, engine, state: () => engine.state() };
  }

  pause(runId: string): RunState { return this.engine(runId).dispatch({ type: 'pause' }); }
  cancel(runId: string, force = false): RunState { return this.engine(runId).dispatch({ type: 'cancel', force }); }
  steer(runId: string, message: string, targetRunId = runId): RunState {
    if (!message.trim()) throw new RunFailure('configuration', 'Steering message cannot be empty');
    return this.engine(runId).dispatch({ type: 'steer', targetRunId, message: message.trim() });
  }
  answer(runId: string, questionId: string, answer: string): RunState {
    return this.engine(runId).dispatch({ type: 'answer', questionId, answer });
  }

  /**
   * Reconcile a run after process loss. An incomplete tool is deliberately
   * never retried: its effects are unknown until a human or tool-specific
   * reconciler resolves the invocation.
   */
  recover(runId: string): RunState {
    const journal = RunJournal.open(runId);
    const before = replayRun(runId);
    if (TERMINAL.has(before.status)) return before;
    const events = readRunEvents(runId);
    const started = new Map<string, RunEvent>();
    for (const event of events) {
      const payload = event.payload as any;
      const id = String(payload.invocation_id || payload.id || payload.tool_use_id || '');
      if (event.type === 'tool_started' && id) started.set(id, event);
      if (event.type === 'tool_completed' && id) started.delete(id);
    }
    journal.append('run_recovered', { previous_status: before.status, incomplete_tools: [...started.keys()] });
    if (started.size) journal.transition('needs_reconciliation', { incomplete_tools: [...started.keys()] });
    else journal.transition('paused', { reason: 'recovered_after_process_loss' });
    return replayRun(runId);
  }

  async *watch(runId: string, options: { signal?: AbortSignal; pollMs?: number } = {}): AsyncGenerator<RunEvent> {
    let cursor = 0;
    const pollMs = Math.max(10, options.pollMs ?? 100);
    while (!options.signal?.aborted) {
      const events = readRunEvents(runId);
      while (cursor < events.length) yield events[cursor++];
      const state = replayRun(runId);
      if (TERMINAL.has(state.status) && cursor >= events.length) return;
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, pollMs);
        options.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
  }

  list(): Array<{ runId: string; state: RunState }> {
    return listRuns().map(runId => ({ runId, state: replayRun(runId) }));
  }

  private engine(runId: string): RunEngine { return new RunEngine(RunJournal.open(runId)); }
}
