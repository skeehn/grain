import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RunFailure, RunService } from '../src/kernel/index.js';

let home = '';
let previousHome: string | undefined;
beforeEach(() => { previousHome = process.env.GRAIN_HOME; home = mkdtempSync(join(tmpdir(), 'grain-run-service-')); process.env.GRAIN_HOME = home; });
afterEach(() => { rmSync(home, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.GRAIN_HOME; else process.env.GRAIN_HOME = previousHome; });

describe('RunService', () => {
  test('creates, controls, and watches one durable run', async () => {
    const service = new RunService();
    const run = service.create({ task: 'test', cwd: '/repo', provider: 'mock', model: 'mock', policy_profile: 'default' });
    run.engine.dispatch({ type: 'start' });
    service.steer(run.journal.metadata.run_id, 'focus tests');
    service.cancel(run.journal.metadata.run_id, true);
    const events = [];
    for await (const event of service.watch(run.journal.metadata.run_id, { pollMs: 1 })) events.push(event);
    expect(events.map(event => event.type)).toContain('user_steered');
    expect(events.every(event => event.correlation_id === run.journal.metadata.run_id)).toBe(true);
    expect(run.state().status).toBe('cancelled');
  });

  test('recovers uncertain tool execution into reconciliation without retrying it', () => {
    const service = new RunService();
    const run = service.create({ task: 'write', cwd: '/repo', provider: 'mock', model: 'mock', policy_profile: 'default' });
    run.engine.dispatch({ type: 'start' });
    run.journal.append('tool_started', { invocation_id: 'write-1', name: 'write' });
    const state = service.recover(run.journal.metadata.run_id);
    expect(state.status).toBe('needs_reconciliation');
    expect(state.pending_tool).toBeUndefined();
  });

  test('rejects empty steering with a structured failure', () => {
    const service = new RunService();
    const run = service.create({ task: 'test', cwd: '/repo', provider: 'mock', model: 'mock', policy_profile: 'default' });
    expect(() => service.steer(run.journal.metadata.run_id, ' ')).toThrow(RunFailure);
  });
});
