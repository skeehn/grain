import { beforeEach, describe, expect, test } from 'bun:test';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RunJournal, readRunEvents, replayRun, runDirectory, redactTrajectory } from '../src/kernel/index.js';

beforeEach(() => { mkdtempSync(join(process.env.GRAIN_HOME!, 'grain-kernel-')); });

describe('event-sourced run journal', () => {
  test('replays a hash-chained run to its terminal state', () => {
    const journal = RunJournal.create({ task: 'test', cwd: '/tmp', provider: 'mock', model: 'mock', policy_profile: 'default' });
    journal.transition('running');
    journal.append('model_requested', { turn: 1 });
    journal.transition('succeeded');
    const state = replayRun(journal.metadata.run_id);
    expect(state.status).toBe('succeeded');
    expect(state.last_sequence).toBe(4);
    expect(readRunEvents(journal.metadata.run_id).every(event => event.hash.length === 64)).toBe(true);
  });

  test('fails closed when a persisted event is tampered with', () => {
    const journal = RunJournal.create({ task: 'test', cwd: '/tmp', provider: 'mock', model: 'mock', policy_profile: 'default' });
    journal.transition('running');
    const path = join(runDirectory(journal.metadata.run_id), 'events.jsonl');
    writeFileSync(path, readFileSync(path, 'utf8').replace('running', 'succeeded'));
    expect(() => replayRun(journal.metadata.run_id)).toThrow('Invalid run event hash');
  });

  test('rejects a truncated JSON event', () => {
    const journal = RunJournal.create({ task: 'test', cwd: '/tmp', provider: 'mock', model: 'mock', policy_profile: 'default' });
    appendFileSync(join(runDirectory(journal.metadata.run_id), 'events.jsonl'), '{');
    expect(() => replayRun(journal.metadata.run_id)).toThrow('Corrupt run journal');
  });

  test('redacts credentials, canaries, and home paths before publication', () => {
    const redacted = redactTrajectory({ authorization: 'Bearer secret', value: 'sk-or-abcdefghijklmnop',
      path: `${process.env.HOME}/private`, canary: 'terminal-bench-canary-abc' }) as any;
    expect(redacted.authorization).toBe('[REDACTED]');
    expect(redacted.value).toBe('[REDACTED_SECRET]');
    expect(redacted.path).toBe('~/private');
    expect(redacted.canary).toBe('[REDACTED_CANARY]');
  });

  test('hashes optional undefined fields exactly as JSON persists them', () => {
    const journal = RunJournal.create({ task: 'optional fields', cwd: process.cwd(), provider: 'test', model: 'test', policy_profile: 'test' });
    journal.append('model_requested', { manifest: { source: undefined, selected: [undefined, { value: 1 }] } });
    expect(() => readRunEvents(journal.metadata.run_id)).not.toThrow();
  });
});
