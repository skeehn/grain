import {
  appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync,
  readFileSync, readdirSync, renameSync, statSync, writeFileSync,
} from 'fs';
import { createHash, randomUUID } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';
import type { RunEvent, RunEventType, RunMetadata, RunState, RunStatus } from './types.js';
import { RUN_EVENT_SCHEMA_VERSION, SUPPORTED_RUN_EVENT_SCHEMA_VERSIONS } from './types.js';
import { redactTrajectory } from './redaction.js';

function grainHome(): string {
  return process.env.GRAIN_HOME || join(homedir(), '.grain');
}

function stable(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(item => stable(item === undefined ? null : item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function eventHash(event: Omit<RunEvent, 'hash'>): string {
  return createHash('sha256').update(stable(event)).digest('hex');
}

export function runDirectory(runId: string): string {
  return join(grainHome(), 'runs', runId);
}

export function listRuns(): string[] {
  const root = join(grainHome(), 'runs');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map(name => {
      const path = join(root, name, 'events.jsonl');
      if (!existsSync(path)) return undefined;
      let createdAt = statSync(path).birthtimeMs || statSync(path).mtimeMs;
      try {
        const firstLine = readFileSync(path, 'utf8').split('\n', 1)[0];
        const first = JSON.parse(firstLine) as RunEvent;
        const timestamp = String((first.payload as any)?.created_at || first.timestamp || '');
        const parsed = Date.parse(timestamp);
        if (Number.isFinite(parsed)) createdAt = parsed;
      } catch { /* keep the journal visible; replayRun reports corruption */ }
      return { name, createdAt };
    })
    .filter((run): run is { name: string; createdAt: number } => Boolean(run))
    .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
    .map(run => run.name);
}

export function readRunEvents(runId: string): RunEvent[] {
  const path = join(runDirectory(runId), 'events.jsonl');
  if (!existsSync(path)) throw new Error(`Run not found: ${runId}`);
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const events = lines.map((line, index) => {
    try { return JSON.parse(line) as RunEvent; }
    catch { throw new Error(`Corrupt run journal at line ${index + 1}`); }
  });
  let previous: string | null = null;
  events.forEach((event, index) => {
    if (!(SUPPORTED_RUN_EVENT_SCHEMA_VERSIONS as readonly number[]).includes(event.schema_version)) throw new Error(`Unsupported run schema: ${event.schema_version}`);
    if (event.sequence !== index + 1) throw new Error(`Invalid run sequence at event ${index + 1}`);
    if (event.previous_hash !== previous) throw new Error(`Broken run hash chain at event ${index + 1}`);
    const { hash, ...unsigned } = event;
    if (eventHash(unsigned) !== hash) throw new Error(`Invalid run event hash at event ${index + 1}`);
    previous = hash;
  });
  return events;
}

export function replayRun(runId: string): RunState {
  const events = readRunEvents(runId);
  if (!events.length || events[0].type !== 'run_created') throw new Error('Run journal has no run_created event');
  const metadata = events[0].payload as unknown as RunMetadata;
  const state: RunState = { metadata, status: 'created', last_sequence: 0, last_hash: null };
  for (const event of events) {
    state.last_sequence = event.sequence;
    state.last_hash = event.hash;
    if (event.type === 'status_changed' || event.type === 'run_completed' || event.type === 'run_paused' || event.type === 'run_resumed') {
      state.status = (event.payload as any).status;
    }
    if (event.type === 'tool_proposed') state.pending_tool = event.payload as any;
    if (event.type === 'tool_completed') state.pending_tool = undefined;
    if (event.type === 'user_questioned') {
      const payload = event.payload as { question_id: string; question: string; choices?: string[] };
      state.pending_question = { id: payload.question_id, question: payload.question, choices: payload.choices || [] };
    }
    if (event.type === 'user_answered') state.pending_question = undefined;
    if (event.type === 'provider_error' || event.type === 'protocol_error') state.error = String((event.payload as any).error);
  }
  return state;
}

export class RunJournal {
  readonly metadata: RunMetadata;
  private sequence = 0;
  private previousHash: string | null = null;
  private readonly path: string;

  private constructor(metadata: RunMetadata) {
    this.metadata = metadata;
    const dir = runDirectory(metadata.run_id);
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, 'events.jsonl');
  }

  static create(input: Omit<RunMetadata, 'run_id' | 'created_at'> & { run_id?: string }): RunJournal {
    const metadata: RunMetadata = { ...input, run_id: input.run_id || randomUUID(), created_at: new Date().toISOString() };
    const journal = new RunJournal(metadata);
    journal.append('run_created', metadata as any);
    return journal;
  }

  static open(runId: string): RunJournal {
    const state = replayRun(runId);
    const journal = new RunJournal(state.metadata);
    journal.sequence = state.last_sequence;
    journal.previousHash = state.last_hash;
    return journal;
  }

  append<T extends Record<string, unknown>>(type: RunEventType, payload: T): RunEvent<T> {
    const unsigned = {
      schema_version: RUN_EVENT_SCHEMA_VERSION,
      run_id: this.metadata.run_id,
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      type,
      previous_hash: this.previousHash,
      payload,
    } as const;
    const event: RunEvent<T> = { ...unsigned, hash: eventHash(unsigned) };
    const fd = openSync(this.path, 'a', 0o600);
    try { appendFileSync(fd, JSON.stringify(event) + '\n'); fsyncSync(fd); }
    finally { closeSync(fd); }
    this.previousHash = event.hash;
    return event;
  }

  transition(status: RunStatus, detail?: Record<string, unknown>): void {
    this.append(status === 'succeeded' || status === 'failed' || status === 'cancelled'
      ? 'run_completed' : 'status_changed', { status, ...detail });
  }

  command(command: import('./types.js').RunCommand): void {
    if (command.type === 'pause') { this.append('run_paused', { status: 'paused' }); return; }
    if (command.type === 'resume') { this.append('run_resumed', { status: 'running' }); return; }
    if (command.type === 'cancel') { this.append('run_cancel_requested', { force: Boolean(command.force) }); return; }
    if (command.type === 'steer') { this.append('user_steered', { target_run_id: command.targetRunId, message: command.message }); return; }
    if (command.type === 'reconcile') { this.append('filesystem_transaction_reconciliation', { invocation_id: command.invocationId, resolution: command.resolution }); return; }
    this.append('status_changed', { status: replayRun(this.metadata.run_id).status, command });
  }

  export(path: string): void {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(redactTrajectory({ metadata: this.metadata, events: readRunEvents(this.metadata.run_id) }), null, 2));
    renameSync(tmp, path);
  }
}
