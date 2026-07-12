import { describe, expect, test } from 'bun:test';
import { RunEngine, RunJournal, eventHash, readRunEvents, replayRun, runDirectory } from '../src/kernel/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

describe('run event schema v2', () => {
  test('persists pause, resume, steering, and cancellation commands', () => {
    const journal = RunJournal.create({ task: 'commands', cwd: process.cwd(), provider: 'test', model: 'test', policy_profile: 'default' });
    const engine = new RunEngine(journal); engine.dispatch({ type: 'start' }); engine.dispatch({ type: 'pause' });
    expect(engine.state().status).toBe('paused'); engine.dispatch({ type: 'steer', targetRunId: 'child', message: 'focus tests' });
    engine.dispatch({ type: 'resume' }); expect(engine.state().status).toBe('running'); engine.dispatch({ type: 'cancel' });
    expect(engine.state().status).toBe('running'); engine.dispatch({ type: 'cancel', force: true });
    expect(engine.state().status).toBe('cancelled');
    const events = readRunEvents(journal.metadata.run_id); expect(events.every(event => event.schema_version === 3)).toBe(true);
    expect(events.map(event => event.type)).toContain('user_steered');
  });
  test('rejects invalid command transitions', () => {
    const engine = new RunEngine(RunJournal.create({ task: 'invalid', cwd: process.cwd(), provider: 'test', model: 'test', policy_profile: 'default' }));
    expect(() => engine.dispatch({ type: 'resume' })).toThrow('Cannot resume');
  });
  test('continues to read immutable schema-v1 journals', () => {
    const metadata = { run_id: `v1-${crypto.randomUUID()}`, task: 'legacy', cwd: process.cwd(), provider: 'test', model: 'test', policy_profile: 'default', created_at: new Date().toISOString() };
    const unsigned: any = { schema_version: 1, run_id: metadata.run_id, sequence: 1, timestamp: new Date().toISOString(), type: 'run_created', previous_hash: null, payload: metadata };
    mkdirSync(runDirectory(metadata.run_id), { recursive: true }); writeFileSync(join(runDirectory(metadata.run_id), 'events.jsonl'), `${JSON.stringify({ ...unsigned, hash: eventHash(unsigned) })}\n`);
    expect(replayRun(metadata.run_id).metadata.task).toBe('legacy');
  });
});
